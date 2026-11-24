/**
 * WsQ: two-way sync of tags between a VHA hub and a Ritt database (*.ritt, SQLite).
 *
 * Only tags are exchanged: the tag tree (name, icon, colour, aliases, new tags, deleted tags)
 * and which files / folders carry which tags. Thumbnails, covers and everything else stay in VHA.
 *
 * Three-way merge against the state of the last sync (snapshot next to the hub):
 *   added on either side -> added, removed on either side -> removed; first sync = union of both.
 *   Conflicting tag properties: VHA wins (VHA is the main program, Ritt the alternative).
 *
 * Writing: a backup of the .ritt is made first, nothing is written while Ritt is running,
 * the file is replaced atomically, and Ritt's own content hash (RittMetadata 300) is recomputed.
 *
 * SQLite: sql.js 1.15.2 (SQLite compiled to WebAssembly, no native code, no network).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

// --------------------------------------------------------------------------------------------
// Data exchanged with Angular
// --------------------------------------------------------------------------------------------

export interface SyncTagIn {
  key: string;              // VHA TagNode.id
  rittId?: number;          // known Ritt vertex id
  name: string;
  icon: string;
  color: string;            // #RRGGBB or ''
  aliases: string[];
  parentKey: string | null; // VHA parent TagNode.id
}

export interface SyncFileIn {
  hash: string;
  segs: string[];           // partialPath folders + file name
  tags: string[];           // VHA TagNode.id of each own tag
}

export interface SyncFolderIn {
  path: string;             // VHA folder partialPath
  tags: string[];           // VHA TagNode.id
}

export interface SyncRequest {
  rittFile: string;
  stateFile: string;        // where the snapshot lives (next to the hub)
  backupDir: string;
  tags: SyncTagIn[];
  files: SyncFileIn[];
  folders: SyncFolderIn[];
  dryRun?: boolean;
}

export interface SyncTagOut {
  rittId: number;
  key?: string;             // VHA TagNode.id if it already exists in VHA
  name: string;
  icon: string;
  color: string;
  aliases: string[];
  parentRittId: number | null;   // null = top level
  pending?: boolean;             // created for the .ritt but not written yet (Ritt was open)
}

export interface SyncResult {
  ok: boolean;
  error?: string;
  wroteRitt: boolean;
  rittRunning: boolean;
  tags: SyncTagOut[];                       // full Ritt tag list after the sync
  deletedKeys: string[];                    // VHA tags deleted in Ritt -> delete in VHA
  fileTags: { hash: string, tags: number[] }[];     // paired files whose tag set changed in VHA
  folderTags: { path: string, tags: number[] }[];   // paired folders whose tag set changed in VHA
  stats: {
    pairedFiles: number, unpairedVhaFiles: number, pairedFolders: number,
    toVha: number, toRitt: number, newTagsVha: number, newTagsRitt: number, deletedTags: number
  };
  backup?: string;
  snapshot?: { file: string, data: any };   // kept in the main process until VHA confirms
}

export function commitRittSnapshot(snap: { file: string, data: any }): void {
  fs.mkdirSync(path.dirname(snap.file), { recursive: true });
  const tmp = snap.file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(snap.data));
  fs.renameSync(tmp, snap.file);
}

// --------------------------------------------------------------------------------------------
// Ritt graph
// --------------------------------------------------------------------------------------------

interface V {
  id: number;
  name: string;            // column Name
  raw: string;             // column Content (JSON)
  obj: any;
  dirty: boolean;
  isNew?: boolean;
}

const TYPE_TAG = 1;
const TYPE_LINK = 2;
const CT_FILE = 1;
const CT_FOLDER = 2;

function vType(v: V): number { return v.obj && v.obj.m ? Number(v.obj.m.t) : -1; }
function vCt(v: V): number { return v.obj && v.obj.m && v.obj.m.c ? Number(v.obj.m.c.t) : 0; }
function vConn(v: V): string { return v.obj && v.obj.m && v.obj.m.c && typeof v.obj.m.c.id === 'string' ? v.obj.m.c.id : ''; }
function ids(a: any): number[] { return Array.isArray(a) ? a.map((x: any) => Number(x)).filter((x: number) => isFinite(x)) : []; }

function colorFromRitt(v: any): string {
  if (typeof v !== 'string') { return ''; }
  const first = v.split(';')[0].trim();
  let m = /^#?([0-9a-f]{2})([0-9a-f]{6})$/i.exec(first);
  if (m) { return m[1].toLowerCase() === '00' ? '' : '#' + m[2].toUpperCase(); }
  m = /^#?([0-9a-f]{6})$/i.exec(first);
  return m ? '#' + m[1].toUpperCase() : '';
}

function colorToRitt(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) { return ''; }
  const n = parseInt(m[1], 16);
  const dark = [16, 8, 0].map(s => Math.round(((n >> s) & 255) * 0.4).toString(16).padStart(2, '0')).join('');
  return '#FF' + m[1].toUpperCase() + ';#FF' + dark.toUpperCase();
}

function aliasesFromRitt(v: any): string[] {
  if (Array.isArray(v)) { return v.map(x => String(x).trim()).filter(Boolean); }
  return typeof v === 'string' ? v.split(/[;\n]/).map(x => x.trim()).filter(Boolean) : [];
}

function tagMeta(v: V) {
  const m = v.obj.m || {};
  const k = m.k || {};
  return {
    name: typeof m.n === 'string' ? m.n : v.name,
    icon: typeof m.i === 'string' ? m.i : '',
    color: colorFromRitt(k['Color']),
    aliases: aliasesFromRitt(k['Alias']),
  };
}

/** folder chain below the Ritt root folder + own name, lower-case */
function segsOf(v: V, all: Map<number, V>): string[] | null {
  if (vConn(v)) { return null; }   // a linked root folder itself
  const parts = [v.name];
  let cur = v;
  for (let guard = 0; guard < 64; guard++) {
    const p = ids(cur.obj.p);
    if (!p.length) { break; }
    const parent = all.get(p[0]);
    if (!parent || vType(parent) !== TYPE_LINK || vCt(parent) !== CT_FOLDER) { break; }
    if (vConn(parent)) { break; }
    parts.unshift(parent.name);
    cur = parent;
  }
  return parts.map(s => (s || '').toLowerCase());
}

function sameSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) { return false; }
  const s = new Set(a);
  return b.every(x => s.has(x));
}

function merge3(base: number[] | undefined, ritt: number[], vha: number[]): number[] {
  if (!base) {
    return Array.from(new Set([...ritt, ...vha]));
  }
  const b = new Set(base);
  const r = new Set(ritt);
  const v = new Set(vha);
  const out = new Set<number>();
  base.forEach(x => { if (r.has(x) && v.has(x)) { out.add(x); } });
  ritt.forEach(x => { if (!b.has(x)) { out.add(x); } });
  vha.forEach(x => { if (!b.has(x)) { out.add(x); } });
  return Array.from(out);
}

function suffix(a: string[], b: string[]): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) { n++; }
  return n;
}

// --------------------------------------------------------------------------------------------
// Is Ritt running? (Windows: tasklist; elsewhere: never)
// --------------------------------------------------------------------------------------------

function rittRunning(): Promise<boolean> {
  return new Promise(resolve => {
    if (process.platform !== 'win32') {
      resolve(false);
      return;
    }
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 8000 }, (err: any, out: string) => {
      if (err || !out) {
        resolve(false);
        return;
      }
      resolve(/^"ritt[^"]*\.exe"/im.test(out));
    });
  });
}

// --------------------------------------------------------------------------------------------
// Main entry
// --------------------------------------------------------------------------------------------

let SQL: any = null;

async function sqlJs(): Promise<any> {
  if (!SQL) {
    const init = require('sql.js/dist/sql-wasm.js');
    const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
    SQL = await init({ wasmBinary: fs.readFileSync(wasmPath) });
  }
  return SQL;
}

export async function syncWithRitt(req: SyncRequest): Promise<SyncResult> {
  const res: SyncResult = {
    ok: false, wroteRitt: false, rittRunning: false, tags: [], deletedKeys: [], fileTags: [], folderTags: [],
    stats: { pairedFiles: 0, unpairedVhaFiles: 0, pairedFolders: 0, toVha: 0, toRitt: 0, newTagsVha: 0, newTagsRitt: 0, deletedTags: 0 },
  };
  let db: any = null;
  try {
    if (!req.rittFile || !fs.existsSync(req.rittFile)) {
      throw new Error('Nie znaleziono pliku .ritt: ' + req.rittFile);
    }
    const wal = req.rittFile + '-wal';
    if (fs.existsSync(wal) && fs.statSync(wal).size > 0) {
      res.rittRunning = true;   // unsaved Ritt changes in the WAL -> Ritt is open
    }
    if (!res.rittRunning) {
      res.rittRunning = await rittRunning();
    }

    const S = await sqlJs();
    const bytes = fs.readFileSync(req.rittFile);
    const stamp = fs.statSync(req.rittFile).mtimeMs;
    db = new S.Database(bytes);

    // ---------- read the graph ----------
    const all = new Map<number, V>();
    const st = db.prepare('SELECT ID, Name, Content FROM RittMainGraph');
    while (st.step()) {
      const r = st.get();
      let obj: any = null;
      try { obj = JSON.parse(r[2]); } catch { obj = null; }
      if (obj) {
        all.set(Number(r[0]), { id: Number(r[0]), name: String(r[1]), raw: String(r[2]), obj, dirty: false });
      }
    }
    st.free();
    let maxId = 0;
    all.forEach(v => { maxId = Math.max(maxId, v.id); });

    const tagRoot = Array.from(all.values()).filter(v => vType(v) === TYPE_TAG && ids(v.obj.p).length === 0).sort((a, b) => a.id - b.id)[0];
    if (!tagRoot) {
      throw new Error('W bazie Ritt nie ma korzenia tagów');
    }
    const isTag = (id: number) => {
      const v = all.get(id);
      return !!v && vType(v) === TYPE_TAG && id !== tagRoot.id;
    };
    const isSeparator = (id: number) => {
      const v = all.get(id);
      const a = v && v.obj.m && v.obj.m.a;
      return !!a && a['4712'] !== undefined && a['4712'] !== 0 && a['4712'] !== false;
    };

    // ---------- snapshot of the last sync ----------
    let base: any = null;
    try {
      const s = JSON.parse(fs.readFileSync(req.stateFile, 'utf8'));
      if (s && s.rittFile && path.resolve(s.rittFile).toLowerCase() === path.resolve(req.rittFile).toLowerCase()) {
        base = s;
      }
    } catch { base = null; }
    const baseTags: Record<string, any> = base ? (base.tags || {}) : {};
    const baseLinks: Record<string, number[]> = base ? (base.links || {}) : {};

    // ---------- tags: VHA key <-> Ritt id ----------
    const keyToRitt = new Map<string, number>();
    const rittToKey = new Map<number, string>();
    const rittByName = new Map<string, number>();
    all.forEach(v => {
      if (isTag(v.id)) {
        const n = tagMeta(v).name.trim().toLowerCase();
        if (!rittByName.has(n)) { rittByName.set(n, v.id); }
      }
    });
    req.tags.forEach(t => {
      if (t.rittId !== undefined && t.rittId !== null && isTag(t.rittId) && !rittToKey.has(t.rittId)) {
        keyToRitt.set(t.key, t.rittId);
        rittToKey.set(t.rittId, t.key);
      }
    });
    req.tags.forEach(t => {   // tags without a known id: same name in Ritt
      if (keyToRitt.has(t.key)) { return; }
      const id = rittByName.get(t.name.trim().toLowerCase());
      if (id !== undefined && !rittToKey.has(id)) {
        keyToRitt.set(t.key, id);
        rittToKey.set(id, t.key);
      }
    });

    const touch = (v: V) => { v.dirty = true; };
    const removeFrom = (arr: any, x: number) => Array.isArray(arr) ? arr.filter((y: any) => Number(y) !== x) : [];

    // ---------- deleted tags ----------
    // in base, gone from Ritt -> delete in VHA; in base, gone from VHA -> delete in Ritt
    const vhaKeys = new Set(req.tags.map(t => t.key));
    Object.keys(baseTags).forEach(k => {
      const id = Number(k);
      const inRitt = isTag(id);
      const key = rittToKey.get(id);
      const inVha = !!key && vhaKeys.has(key);
      if (!inRitt && key && inVha) {
        res.deletedKeys.push(key);
        keyToRitt.delete(key);
        rittToKey.delete(id);
        res.stats.deletedTags++;
      } else if (inRitt && !inVha && !Array.from(keyToRitt.values()).includes(id)) {
        // deleted in VHA -> remove the vertex in Ritt, its children move up, links lose it
        const v = all.get(id);
        const parentIds = ids(v.obj.p);
        const children = ids(v.obj.c);
        parentIds.forEach(pid => {
          const p = all.get(pid);
          if (p) {
            const c = ids(p.obj.c);
            const at = c.indexOf(id);
            c.splice(at < 0 ? c.length : at, at < 0 ? 0 : 1, ...children);
            p.obj.c = c;
            touch(p);
          }
        });
        children.forEach(cid => {
          const c = all.get(cid);
          if (c) {
            c.obj.p = ids(c.obj.p).filter(x => x !== id).concat(parentIds.length ? [parentIds[0]] : []);
            touch(c);
          }
        });
        ids(v.obj.l).forEach(lid => {
          const l = all.get(lid);
          if (l) { l.obj.t = removeFrom(l.obj.t, id); touch(l); }
        });
        all.delete(id);
        (res as any)._deletedRitt = ((res as any)._deletedRitt || []).concat([id]);
        res.stats.deletedTags++;
      }
    });

    // ---------- new VHA tags -> Ritt (parents first) ----------
    const byKey = new Map<string, SyncTagIn>();
    req.tags.forEach(t => byKey.set(t.key, t));
    const ensureRitt = (t: SyncTagIn, guard = 0): number => {
      const known = keyToRitt.get(t.key);
      if (known !== undefined) { return known; }
      let parentId = tagRoot.id;
      if (t.parentKey && byKey.has(t.parentKey) && guard < 64) {
        parentId = ensureRitt(byKey.get(t.parentKey), guard + 1);
      }
      const id = ++maxId;
      const k: any = {};
      if (t.aliases.length) { k['Alias'] = t.aliases.join(';'); }
      if (t.color && colorToRitt(t.color)) { k['Color'] = colorToRitt(t.color); }
      const obj = { p: [parentId], c: [], s: [], t: [], l: [], m: { t: 1, n: t.name, c: { t: 0, id: null }, i: t.icon || '', a: {}, k }, i: id };
      const v: V = { id, name: t.name, raw: '', obj, dirty: true, isNew: true };
      all.set(id, v);
      const parent = all.get(parentId);
      parent.obj.c = ids(parent.obj.c).concat([id]);
      touch(parent);
      keyToRitt.set(t.key, id);
      rittToKey.set(id, t.key);
      res.stats.newTagsRitt++;
      return id;
    };
    req.tags.forEach(t => ensureRitt(t));

    // ---------- tag properties (name, icon, colour, aliases) ----------
    req.tags.forEach(t => {
      const id = keyToRitt.get(t.key);
      const v = all.get(id);
      if (!v || v.isNew) { return; }
      const cur = tagMeta(v);
      const b = baseTags[String(id)];
      const m = v.obj.m;
      m.k = m.k || {};
      const pick = (vhaVal: any, rittVal: any, baseVal: any, eq: (a: any, b: any) => boolean) => {
        if (!b) { return vhaVal; }                       // first sync: VHA wins
        if (!eq(vhaVal, baseVal)) { return vhaVal; }     // changed in VHA
        return rittVal;                                  // else whatever Ritt has
      };
      const eqS = (a: string, c: string) => (a || '') === (c || '');
      const eqA = (a: string[], c: string[]) => (a || []).join(';') === (c || []).join(';');
      const name = pick(t.name, cur.name, b && b.name, eqS);
      const icon = pick(t.icon, cur.icon, b && b.icon, eqS);
      const color = pick(t.color, cur.color, b && b.color, eqS);
      const aliases = pick(t.aliases, cur.aliases, b && b.aliases, eqA);
      if (name !== cur.name) { m.n = name; v.name = name; touch(v); }
      if (icon !== cur.icon) { m.i = icon; touch(v); }
      if (!eqS(color, cur.color)) {
        if (color && colorToRitt(color)) { m.k['Color'] = colorToRitt(color); } else { delete m.k['Color']; }
        touch(v);
      }
      if (!eqA(aliases, cur.aliases)) {
        if (aliases.length) { m.k['Alias'] = aliases.join(';'); } else { delete m.k['Alias']; }
        touch(v);
      }
    });

    // ---------- pair files and folders ----------
    const rittFiles: V[] = [];
    const rittFolders: V[] = [];
    all.forEach(v => {
      if (vType(v) === TYPE_LINK) {
        if (vCt(v) === CT_FILE) { rittFiles.push(v); } else if (vCt(v) === CT_FOLDER && !vConn(v)) { rittFolders.push(v); }
      }
    });
    const pairUp = <T>(rittList: V[], vhaList: T[], segsOfVha: (x: T) => string[]): Map<V, T> => {
      const byLast = new Map<string, T[]>();
      vhaList.forEach(x => {
        const s = segsOfVha(x);
        const last = s[s.length - 1];
        if (!byLast.has(last)) { byLast.set(last, []); }
        byLast.get(last).push(x);
      });
      const pairs = new Map<V, T>();
      const used = new Map<T, number>();
      rittList.forEach(v => {
        const rs = segsOf(v, all);
        if (!rs || !rs.length) { return; }
        const cands = byLast.get(rs[rs.length - 1]) || [];
        let best = -1;
        let chosen: T[] = [];
        cands.forEach(c => {
          const n = suffix(segsOfVha(c), rs);
          if (n > best) { best = n; chosen = [c]; } else if (n === best) { chosen.push(c); }
        });
        if (chosen.length === 1) {
          pairs.set(v, chosen[0]);
          used.set(chosen[0], (used.get(chosen[0]) || 0) + 1);
        }
      });
      pairs.forEach((x, v) => { if (used.get(x) > 1) { pairs.delete(v); } });   // only 1:1 pairs
      return pairs;
    };
    const lower = (a: string[]) => a.map(s => (s || '').toLowerCase());
    const filePairs = pairUp(rittFiles, req.files, f => lower(f.segs));
    const folderPairs = pairUp(rittFolders, req.folders, f => lower(f.path.split('/').filter(Boolean)));
    res.stats.pairedFiles = filePairs.size;
    res.stats.pairedFolders = folderPairs.size;
    res.stats.unpairedVhaFiles = req.files.filter(f => f.tags.length).length - Array.from(filePairs.values()).filter(f => f.tags.length).length;

    // ---------- merge assignments ----------
    const newLinks: Record<string, number[]> = {};
    const applyPair = (v: V, vhaTagKeys: string[], onVha: (tags: number[]) => void) => {
      const rittNow = ids(v.obj.t).filter(isTag);
      const vhaNow = vhaTagKeys.map(k => keyToRitt.get(k)).filter(x => x !== undefined);
      const result = merge3(baseLinks[String(v.id)], rittNow, vhaNow).filter(x => all.has(x));
      if (!sameSet(result, rittNow)) {
        const keep = ids(v.obj.t).filter(x => !isTag(x) && all.has(x));
        rittNow.filter(x => !result.includes(x)).forEach(x => { const tv = all.get(x); if (tv) { tv.obj.l = removeFrom(tv.obj.l, v.id); touch(tv); } });
        result.filter(x => !rittNow.includes(x)).forEach(x => { const tv = all.get(x); if (tv) { tv.obj.l = ids(tv.obj.l).concat([v.id]); touch(tv); } });
        v.obj.t = keep.concat(result);
        touch(v);
        res.stats.toRitt++;
      }
      if (!sameSet(result, vhaNow)) {
        onVha(result);
        res.stats.toVha++;
      }
      if (result.length) { newLinks[String(v.id)] = result; }
    };
    filePairs.forEach((f, v) => applyPair(v, f.tags, tags => res.fileTags.push({ hash: f.hash, tags })));
    folderPairs.forEach((f, v) => applyPair(v, f.tags, tags => res.folderTags.push({ path: f.path, tags })));
    // links we could not pair keep their last known state
    Object.keys(baseLinks).forEach(k => {
      if (!(k in newLinks) && all.has(Number(k)) && !Array.from(filePairs.keys()).some(v => String(v.id) === k)) {
        const now = ids(all.get(Number(k)).obj.t).filter(isTag);
        if (now.length) { newLinks[k] = now; }
      }
    });

    // ---------- result tag list (Ritt order, parents first) ----------
    const walk = (parentId: number, parentOut: number | null, seen: Set<number>) => {
      ids(all.get(parentId).obj.c).forEach(cid => {
        if (!isTag(cid) || isSeparator(cid) || seen.has(cid)) { return; }
        seen.add(cid);
        const v = all.get(cid);
        const meta = tagMeta(v);
        res.tags.push({ rittId: cid, key: rittToKey.get(cid), parentRittId: parentOut, pending: !!v.isNew, ...meta });
        if (!rittToKey.has(cid)) { res.stats.newTagsVha++; }
        walk(cid, cid, seen);
      });
    };
    walk(tagRoot.id, null, new Set<number>());

    // ---------- write ----------
    const deletedRitt: number[] = (res as any)._deletedRitt || [];
    delete (res as any)._deletedRitt;
    const changed = Array.from(all.values()).filter(v => v.dirty);
    if ((changed.length || deletedRitt.length) && !req.dryRun) {
      if (res.rittRunning) {
        // Ritt is open: take what Ritt has into VHA, but do not touch the .ritt now
        res.ok = true;
        res.error = 'ritt-running';
        return res;
      }
      if (fs.statSync(req.rittFile).mtimeMs !== stamp) {
        throw new Error('Plik .ritt zmienił się w trakcie synchronizacji — spróbuj jeszcze raz');
      }
      // backup (keeps the 10 newest)
      fs.mkdirSync(req.backupDir, { recursive: true });
      const stampName = new Date().toISOString().replace(/[:.]/g, '-');
      const backup = path.join(req.backupDir, path.basename(req.rittFile, '.ritt') + '_' + stampName + '.ritt');
      fs.copyFileSync(req.rittFile, backup);
      res.backup = backup;
      const olds = fs.readdirSync(req.backupDir).filter((f: string) => f.endsWith('.ritt')).sort();
      olds.slice(0, Math.max(0, olds.length - 10)).forEach((f: string) => { try { fs.unlinkSync(path.join(req.backupDir, f)); } catch { } });

      db.run('BEGIN');
      const up = db.prepare('INSERT OR REPLACE INTO RittMainGraph (ID, Name, Content) VALUES (?, ?, ?)');
      changed.forEach(v => {
        const json = JSON.stringify(v.obj);
        up.run([v.id, v.name, json]);
        v.raw = json;
      });
      up.free();
      const del = db.prepare('DELETE FROM RittMainGraph WHERE ID = ?');
      deletedRitt.forEach(id => del.run([id]));
      del.free();
      updateRittMetadata(db);
      db.run('COMMIT');

      const out: Uint8Array = db.export();
      const tmp = req.rittFile + '.vha-tmp';
      fs.writeFileSync(tmp, Buffer.from(out));
      fs.renameSync(tmp, req.rittFile);
      res.wroteRitt = true;
      res.tags.forEach(t => { t.pending = false; });
    }

    // ---------- snapshot ----------
    // the snapshot is saved only after VHA applied the result and saved the hub (commitRittSnapshot)
    if (!req.dryRun && (res.wroteRitt || !changed.length)) {
      const snapTags: Record<string, any> = {};
      res.tags.forEach(t => { snapTags[String(t.rittId)] = { name: t.name, icon: t.icon, color: t.color, aliases: t.aliases }; });
      res.snapshot = { file: req.stateFile, data: { rittFile: req.rittFile, at: Date.now(), tags: snapTags, links: newLinks } };
    }
    res.ok = true;
  } catch (e) {
    res.ok = false;
    res.error = (e && e.message) ? e.message : String(e);
  } finally {
    try { if (db) { db.close(); } } catch { }
  }
  return res;
}

/**
 * Ritt keeps an MD5 of its content in RittMetadata (ID 300):
 * md5( meta100 + "\r\n" + meta200 + "\r\n" + all RittMainGraph.Content ordered by ID, joined by "\r\n" ), upper-case hex,
 * and the time of the last change in ID 400 (.NET ticks). Recomputed after our write.
 */
function updateRittMetadata(db: any): void {
  let hasMeta = false;
  try {
    const r = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='RittMetadata'");
    hasMeta = !!(r.length && r[0].values.length);
  } catch { hasMeta = false; }
  if (!hasMeta) {
    return;
  }
  const meta = new Map<number, string>();
  const rows = db.exec('SELECT ID, Content FROM RittMetadata');
  (rows.length ? rows[0].values : []).forEach((r: any[]) => meta.set(Number(r[0]), String(r[1])));
  if (meta.has(300) && meta.has(100) && meta.has(200)) {
    const contents: string[] = [];
    const st = db.prepare('SELECT Content FROM RittMainGraph ORDER BY ID');
    while (st.step()) { contents.push(String(st.get()[0])); }
    st.free();
    const hash = crypto.createHash('md5').update([meta.get(100), meta.get(200), ...contents].join('\r\n'), 'utf8').digest('hex').toUpperCase();
    db.run('UPDATE RittMetadata SET Content = ? WHERE ID = 300', [hash]);
  }
  if (meta.has(400)) {
    const ticks = String(Date.now() + 62135596800000) + '0000';   // .NET ticks (100 ns since 0001-01-01)
    db.run('UPDATE RittMetadata SET Content = ? WHERE ID = 400', [ticks]);
  }
}
