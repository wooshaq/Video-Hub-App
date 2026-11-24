/**
 * WsQ: the Ritt database (*.ritt, SQLite) as THE tag database of VHA.
 *
 * Ritt keeps: the tag tree (order, nesting, separators), tag properties (name, icon, colour, aliases,
 * notes, hidden, encapsulate, badge, hotkey, inheritance), which files / folders carry which tags,
 * and notes of files, folders and tags. VHA keeps only what Ritt has no place for (thumbnails, covers,
 * media info ...) plus tags of files Ritt does not know.
 *
 * Every call is a three-way merge against the state of the last sync (snapshot next to the hub):
 * a change on either side wins over "unchanged", VHA wins a real conflict. Data VHA does not have
 * yet (right after start, before the first sync) is sent as null = "take whatever Ritt has".
 *
 * Writing: backup first (10 newest), nothing is written while Ritt is open, atomic replace,
 * Ritt's own content hash (RittMetadata 300) and change time (400) are recomputed.
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

export interface TagProps {
  name: string;
  icon: string;
  color: string;           // #RRGGBB or ''
  aliases: string[];
  notes: string;
  hidden: boolean;
  encapsulate: boolean;
  badge: boolean;
  hotkey: string;          // '' or '0'..'9'
  inherit: number | null;  // null = Ritt default (no explicit depth)
  separator: boolean;
}

export interface SyncTagIn extends TagProps {
  key: string;             // VHA TagNode.id
  rittId?: number;
  parentKey: string | null;
}

export interface SyncFileIn {
  hash: string;
  root: string;            // basename of the VHA source folder (lower-case)
  segs: string[];          // partialPath folders + file name
  tags: string[] | null;   // VHA TagNode.id of each tag, null = unknown (take Ritt's)
  notes: string | null;
}

export interface SyncFolderIn {
  path: string;            // VHA folder partialPath
  tags: string[] | null;
}

export interface SyncRequest {
  rittFile: string;
  stateFile: string;
  backupDir: string;
  treeKnown: boolean;      // false right after start: the tag tree comes from Ritt as it is
  tags: SyncTagIn[];       // pre-order, siblings in display order
  files: SyncFileIn[];
  folders: SyncFolderIn[];
}

export interface SyncTagOut extends TagProps {
  rittId: number;
  key?: string;
  parentRittId: number | null;
  pending?: boolean;
}

export interface SyncResult {
  ok: boolean;
  error?: string;
  wroteRitt: boolean;
  rittRunning: boolean;
  tags: SyncTagOut[];                                             // the whole tree after the sync, pre-order
  files: { hash: string, tags: number[], notes: string }[];       // every paired file
  folders: { path: string, tags: number[] }[];                    // every paired folder
  stats: { pairedFiles: number, pairedFolders: number, toVha: number, toRitt: number, unknownFiles: number };
  backup?: string;
  mtime?: number;
  snapshot?: { file: string, data: any };
}

// --------------------------------------------------------------------------------------------
// Ritt graph helpers
// --------------------------------------------------------------------------------------------

interface V { id: number; name: string; obj: any; dirty: boolean; isNew?: boolean; }

const TYPE_TAG = 1;
const TYPE_LINK = 2;
const CT_FILE = 1;
const CT_FOLDER = 2;
const A_HIDDEN = '2848';
const A_ENCAPSULATE = '3217';
const A_BADGE = '4626';
const A_SEPARATOR = '4712';
const A_HOTKEY = '5183';
const A_INHERIT = '6245';

function vType(v: V): number { return v.obj && v.obj.m ? Number(v.obj.m.t) : -1; }
function vCt(v: V): number { return v.obj && v.obj.m && v.obj.m.c ? Number(v.obj.m.c.t) : 0; }
function vConn(v: V): string { return v.obj && v.obj.m && v.obj.m.c && typeof v.obj.m.c.id === 'string' ? v.obj.m.c.id : ''; }
function ids(a: any): number[] { return Array.isArray(a) ? a.map((x: any) => Number(x)).filter((x: number) => isFinite(x)) : []; }
function truthy(v: any): boolean {
  return v === true || (typeof v === 'number' && v !== 0) || (typeof v === 'string' && v !== '' && v !== '0' && v.toLowerCase() !== 'false');
}

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

function hotkeyFrom(v: any): string {
  if (v === undefined || v === null || v === false) { return ''; }
  if (typeof v === 'string' && /^[0-9]$/.test(v)) { return v; }
  const n = typeof v === 'number' ? Math.round(v) : parseFloat(v);
  if (n >= 0 && n <= 9) { return String(n); }
  return n === 10 ? '0' : '';
}

function inheritFrom(v: any): number | null {
  if (v === undefined || v === null || v === false) { return null; }
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!isFinite(n) || n < 0 || n >= 100) { return null; }
  return Math.round(n);
}

function propsOf(v: V): TagProps {
  const m = v.obj.m || {};
  const k = m.k || {};
  const a = m.a || {};
  return {
    name: typeof m.n === 'string' ? m.n : v.name,
    icon: typeof m.i === 'string' ? m.i : '',
    color: colorFromRitt(k['Color']),
    aliases: aliasesFromRitt(k['Alias']),
    notes: typeof k['Notes'] === 'string' ? k['Notes'] : '',
    hidden: truthy(a[A_HIDDEN]),
    encapsulate: truthy(a[A_ENCAPSULATE]),
    badge: truthy(a[A_BADGE]),
    hotkey: hotkeyFrom(a[A_HOTKEY]),
    inherit: inheritFrom(a[A_INHERIT]),
    separator: truthy(a[A_SEPARATOR]),
  };
}

const PROP_KEYS: (keyof TagProps)[] = ['name', 'icon', 'color', 'aliases', 'notes', 'hidden', 'encapsulate', 'badge', 'hotkey', 'inherit', 'separator'];

function same(a: any, b: any): boolean {
  if (Array.isArray(a) || Array.isArray(b)) { return (a || []).join('\u0001') === (b || []).join('\u0001'); }
  return (a === undefined ? null : a) === (b === undefined ? null : b);
}

function setProp(v: V, key: keyof TagProps, val: any): void {
  const m = v.obj.m = v.obj.m || {};
  const k = m.k = m.k || {};
  const a = m.a = m.a || {};
  const flag = (attr: string, on: boolean) => { if (on) { a[attr] = 1.0; } else { delete a[attr]; } };
  switch (key) {
    case 'name': m.n = val; v.name = val; break;
    case 'icon': m.i = val || ''; break;
    case 'color': if (val && colorToRitt(val)) { k['Color'] = colorToRitt(val); } else { delete k['Color']; } break;
    case 'aliases': if (val && val.length) { k['Alias'] = val.join(';'); } else { delete k['Alias']; } break;
    case 'notes': if (val) { k['Notes'] = val; } else { delete k['Notes']; } break;
    case 'hidden': flag(A_HIDDEN, !!val); break;
    case 'encapsulate': flag(A_ENCAPSULATE, !!val); break;
    case 'badge': flag(A_BADGE, !!val); break;
    case 'separator': flag(A_SEPARATOR, !!val); break;
    case 'hotkey': if (val) { a[A_HOTKEY] = parseInt(val, 10); } else { delete a[A_HOTKEY]; } break;
    case 'inherit': if (val === null || val === undefined) { delete a[A_INHERIT]; } else { a[A_INHERIT] = val; } break;
  }
  v.dirty = true;
}

function merge3(base: number[] | undefined, ritt: number[], vha: number[] | null): number[] {
  if (vha === null) { return ritt.slice(); }
  if (!base) { return Array.from(new Set([...ritt, ...vha])); }
  const b = new Set(base);
  const r = new Set(ritt);
  const v = new Set(vha);
  const out = new Set<number>();
  base.forEach(x => { if (r.has(x) && v.has(x)) { out.add(x); } });
  ritt.forEach(x => { if (!b.has(x)) { out.add(x); } });
  vha.forEach(x => { if (!b.has(x)) { out.add(x); } });
  return Array.from(out);
}

function mergeValue<T>(base: T | undefined, ritt: T, vha: T | null, vhaWinsWithoutBase: boolean): T {
  if (vha === null) { return ritt; }
  if (base === undefined) { return vhaWinsWithoutBase ? vha : ritt; }
  if (!same(vha, base)) { return vha; }
  return ritt;
}

function sameSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) { return false; }
  const s = new Set(a);
  return b.every(x => s.has(x));
}

function suffixLen(a: string[], b: string[]): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) { n++; }
  return n;
}

function rittRunning(): Promise<boolean> {
  return new Promise(resolve => {
    if (process.platform !== 'win32') {
      resolve(false);
      return;
    }
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 8000 }, (err: any, out: string) => {
      resolve(!err && !!out && /^"ritt[^"]*\.exe"/im.test(out));
    });
  });
}

let SQL: any = null;
async function sqlJs(): Promise<any> {
  if (!SQL) {
    const init = require('sql.js/dist/sql-wasm.js');
    SQL = await init({ wasmBinary: fs.readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm')) });
  }
  return SQL;
}

export function rittMtime(file: string): number {
  try { return fs.statSync(file).mtimeMs; } catch { return 0; }
}

// --------------------------------------------------------------------------------------------
// Main entry
// --------------------------------------------------------------------------------------------

export async function syncWithRitt(req: SyncRequest): Promise<SyncResult> {
  const res: SyncResult = {
    ok: false, wroteRitt: false, rittRunning: false, tags: [], files: [], folders: [],
    stats: { pairedFiles: 0, pairedFolders: 0, toVha: 0, toRitt: 0, unknownFiles: 0 },
  };
  let db: any = null;
  try {
    if (!req.rittFile || !fs.existsSync(req.rittFile)) {
      throw new Error('Nie znaleziono pliku .ritt: ' + req.rittFile);
    }
    const wal = req.rittFile + '-wal';
    res.rittRunning = (fs.existsSync(wal) && fs.statSync(wal).size > 0) || await rittRunning();

    const S = await sqlJs();
    const stamp = fs.statSync(req.rittFile).mtimeMs;
    db = new S.Database(fs.readFileSync(req.rittFile));

    // ---------- graph ----------
    const all = new Map<number, V>();
    const st = db.prepare('SELECT ID, Name, Content FROM RittMainGraph');
    while (st.step()) {
      const r = st.get();
      try { all.set(Number(r[0]), { id: Number(r[0]), name: String(r[1]), obj: JSON.parse(r[2]), dirty: false }); } catch { }
    }
    st.free();
    let maxId = 0;
    all.forEach(v => { maxId = Math.max(maxId, v.id); });
    const tagRoot = Array.from(all.values()).filter(v => vType(v) === TYPE_TAG && ids(v.obj.p).length === 0).sort((a, b) => a.id - b.id)[0];
    if (!tagRoot) {
      throw new Error('W bazie Ritt nie ma korzenia tagów');
    }
    const isTag = (id: number) => { const v = all.get(id); return !!v && vType(v) === TYPE_TAG && id !== tagRoot.id; };
    const parentOf = (id: number) => { const p = ids(all.get(id).obj.p); return p.length ? p[0] : tagRoot.id; };
    const removeId = (arr: any, x: number) => ids(arr).filter(y => y !== x);

    // ---------- snapshot of the last sync ----------
    let base: any = null;
    try {
      const s = JSON.parse(fs.readFileSync(req.stateFile, 'utf8'));
      if (s && s.v === 2 && path.resolve(s.rittFile).toLowerCase() === path.resolve(req.rittFile).toLowerCase()) { base = s; }
    } catch { base = null; }
    const baseTags: Record<string, any> = base ? base.tags : {};
    const baseLinks: Record<string, { t: number[], n: string }> = base ? base.links : {};
    const baseOrder: Record<string, number[]> = base ? base.order : {};

    // ---------- VHA tags <-> Ritt ids ----------
    const keyToRitt = new Map<string, number>();
    const rittToKey = new Map<number, string>();
    const vhaTags = req.treeKnown ? req.tags : [];
    vhaTags.forEach(t => {
      if (t.rittId !== undefined && t.rittId !== null && isTag(t.rittId) && !rittToKey.has(t.rittId)) {
        keyToRitt.set(t.key, t.rittId);
        rittToKey.set(t.rittId, t.key);
      }
    });
    const rittByName = new Map<string, number>();
    all.forEach(v => {
      if (isTag(v.id) && !propsOf(v).separator) {
        const n = propsOf(v).name.trim().toLowerCase();
        if (!rittByName.has(n)) { rittByName.set(n, v.id); }
      }
    });
    vhaTags.forEach(t => {
      if (keyToRitt.has(t.key) || t.separator) { return; }
      const id = rittByName.get(t.name.trim().toLowerCase());
      if (id !== undefined && !rittToKey.has(id)) { keyToRitt.set(t.key, id); rittToKey.set(id, t.key); }
    });

    const deleted: number[] = [];
    if (req.treeKnown) {
      // ---------- tags deleted in VHA (known at the last sync, gone now) ----------
      Object.keys(baseTags).forEach(k => {
        const id = Number(k);
        if (!isTag(id) || rittToKey.has(id)) { return; }
        const v = all.get(id);
        const pid = parentOf(id);
        const p = all.get(pid);
        const children = ids(v.obj.c);
        if (p) {
          const c = ids(p.obj.c);
          const at = c.indexOf(id);
          c.splice(at < 0 ? c.length : at, at < 0 ? 0 : 1, ...children);
          p.obj.c = c;
          p.dirty = true;
        }
        children.forEach(cid => { const c = all.get(cid); if (c) { c.obj.p = [pid]; c.dirty = true; } });
        ids(v.obj.l).forEach(lid => { const l = all.get(lid); if (l) { l.obj.t = removeId(l.obj.t, id); l.dirty = true; } });
        all.delete(id);
        deleted.push(id);
      });

      // ---------- new VHA tags ----------
      const byKey = new Map<string, SyncTagIn>();
      vhaTags.forEach(t => byKey.set(t.key, t));
      const ensure = (t: SyncTagIn, guard = 0): number => {
        const known = keyToRitt.get(t.key);
        if (known !== undefined) { return known; }
        const pid = t.parentKey && byKey.has(t.parentKey) && guard < 64 ? ensure(byKey.get(t.parentKey), guard + 1) : tagRoot.id;
        const id = ++maxId;
        const v: V = {
          id, name: t.name, dirty: true, isNew: true,
          obj: { p: [pid], c: [], s: [], t: [], l: [], m: { t: 1, n: t.name, c: { t: 0, id: null }, i: '', a: {}, k: {} }, i: id },
        };
        PROP_KEYS.forEach(k => setProp(v, k, (t as any)[k]));
        all.set(id, v);
        const p = all.get(pid);
        p.obj.c = ids(p.obj.c).concat([id]);
        p.dirty = true;
        keyToRitt.set(t.key, id);
        rittToKey.set(id, t.key);
        return id;
      };
      vhaTags.forEach(t => ensure(t));

      // ---------- properties ----------
      vhaTags.forEach(t => {
        const v = all.get(keyToRitt.get(t.key));
        if (!v || v.isNew) { return; }
        const cur = propsOf(v);
        const b = baseTags[String(v.id)];
        PROP_KEYS.forEach(k => {
          const val = mergeValue(b ? b[k] : undefined, cur[k], (t as any)[k], true);
          if (!same(val, cur[k])) { setProp(v, k, val); }
        });
      });

      // ---------- nesting (VHA moved a tag) ----------
      vhaTags.forEach(t => {
        const id = keyToRitt.get(t.key);
        const v = all.get(id);
        if (!v || v.isNew) { return; }
        const vhaParent = t.parentKey ? keyToRitt.get(t.parentKey) : tagRoot.id;
        const b = baseTags[String(id)];
        const rittParent = parentOf(id);
        if (vhaParent === undefined || vhaParent === rittParent) { return; }
        if (!b || vhaParent !== b.parent) {
          const old = all.get(rittParent);
          if (old) { old.obj.c = removeId(old.obj.c, id); old.dirty = true; }
          const np = all.get(vhaParent);
          np.obj.c = ids(np.obj.c).concat([id]);
          np.dirty = true;
          v.obj.p = [vhaParent];
          v.dirty = true;
        }
      });

      // ---------- order of siblings (VHA reordered) ----------
      const vhaOrder = new Map<number, number[]>();
      vhaTags.forEach(t => {
        const pid = t.parentKey ? keyToRitt.get(t.parentKey) : tagRoot.id;
        const id = keyToRitt.get(t.key);
        if (pid === undefined || id === undefined) { return; }
        if (!vhaOrder.has(pid)) { vhaOrder.set(pid, []); }
        vhaOrder.get(pid).push(id);
      });
      vhaOrder.forEach((order, pid) => {
        const p = all.get(pid);
        if (!p) { return; }
        const cur = ids(p.obj.c);
        const curTags = cur.filter(isTag);
        const b = baseOrder[String(pid)];
        if (b && same(order, b)) { return; }              // VHA did not reorder here
        const mine = order.filter(x => curTags.includes(x));
        const rest = curTags.filter(x => !mine.includes(x));
        const next = mine.concat(rest);
        if (!same(next, curTags)) {
          let i = 0;
          p.obj.c = cur.map(x => isTag(x) ? next[i++] : x);
          p.dirty = true;
        }
      });
    }

    // ---------- pair files and folders ----------
    const linkInfo = (v: V): { root: string, segs: string[] } | null => {
      if (vConn(v)) { return null; }
      const parts = [v.name];
      let cur = v;
      let root = '';
      for (let g = 0; g < 64; g++) {
        const p = ids(cur.obj.p);
        const parent = p.length ? all.get(p[0]) : null;
        if (!parent || vType(parent) !== TYPE_LINK || vCt(parent) !== CT_FOLDER) { break; }
        if (vConn(parent)) { root = parent.name; break; }
        parts.unshift(parent.name);
        cur = parent;
      }
      return { root: root.toLowerCase(), segs: parts.map(s => (s || '').toLowerCase()) };
    };
    const rittFiles: V[] = [];
    const rittFolders: V[] = [];
    all.forEach(v => {
      if (vType(v) !== TYPE_LINK) { return; }
      if (vCt(v) === CT_FILE) { rittFiles.push(v); } else if (vCt(v) === CT_FOLDER && !vConn(v)) { rittFolders.push(v); }
    });

    const pairUp = <T>(rittList: V[], vhaList: T[], keyOf: (x: T) => { root: string, segs: string[] }): Map<V, T> => {
      const exact = new Map<string, T[]>();
      const byLast = new Map<string, T[]>();
      vhaList.forEach(x => {
        const k = keyOf(x);
        const full = k.root + '|' + k.segs.join('/');
        if (!exact.has(full)) { exact.set(full, []); }
        exact.get(full).push(x);
        const last = k.segs[k.segs.length - 1];
        if (!byLast.has(last)) { byLast.set(last, []); }
        byLast.get(last).push(x);
      });
      const pairs = new Map<V, T>();
      const used = new Map<T, number>();
      rittList.forEach(v => {
        const info = linkInfo(v);
        if (!info || !info.segs.length) { return; }
        let chosen: T[] = exact.get(info.root + '|' + info.segs.join('/')) || [];
        if (chosen.length !== 1) {
          let best = -1;
          chosen = [];
          (byLast.get(info.segs[info.segs.length - 1]) || []).forEach(c => {
            const n = suffixLen(keyOf(c).segs, info.segs);
            if (n > best) { best = n; chosen = [c]; } else if (n === best) { chosen.push(c); }
          });
        }
        if (chosen.length === 1) {
          pairs.set(v, chosen[0]);
          used.set(chosen[0], (used.get(chosen[0]) || 0) + 1);
        }
      });
      pairs.forEach((x, v) => { if (used.get(x) > 1) { pairs.delete(v); } });
      return pairs;
    };
    const lower = (a: string[]) => a.map(s => (s || '').toLowerCase());
    const filePairs = pairUp(rittFiles, req.files, f => ({ root: (f.root || '').toLowerCase(), segs: lower(f.segs) }));
    const folderPairs = pairUp(rittFolders, req.folders, f => ({ root: '', segs: lower(f.path.split('/').filter(Boolean)) }));
    res.stats.pairedFiles = filePairs.size;
    res.stats.pairedFolders = folderPairs.size;
    const pairedSet = new Set(Array.from(filePairs.values()));
    res.stats.unknownFiles = req.files.filter(f => f.tags && f.tags.length && !pairedSet.has(f)).length;

    // ---------- tags and notes of files / folders ----------
    const newLinks: Record<string, { t: number[], n: string }> = {};
    const mapKeys = (keys: string[] | null) => keys === null ? null : keys.map(k => keyToRitt.get(k)).filter(x => x !== undefined && isTag(x));
    const mergeLink = (v: V, vhaTagsOf: string[] | null, vhaNotes: string | null) => {
      const b = baseLinks[String(v.id)];
      const rittNow = ids(v.obj.t).filter(isTag);
      const result = merge3(b ? b.t : undefined, rittNow, mapKeys(vhaTagsOf)).filter(isTag);
      if (!sameSet(result, rittNow)) {
        rittNow.filter(x => !result.includes(x)).forEach(x => { const tv = all.get(x); tv.obj.l = removeId(tv.obj.l, v.id); tv.dirty = true; });
        result.filter(x => !rittNow.includes(x)).forEach(x => { const tv = all.get(x); tv.obj.l = ids(tv.obj.l).concat([v.id]); tv.dirty = true; });
        v.obj.t = ids(v.obj.t).filter(x => !isTag(x) && all.has(x)).concat(result);
        v.dirty = true;
        res.stats.toRitt++;
      }
      v.obj.m = v.obj.m || {};
      const k = v.obj.m.k || {};
      const rittNotes = typeof k['Notes'] === 'string' ? k['Notes'] : '';
      const notes = mergeValue(b ? b.n : undefined, rittNotes, vhaNotes, true) || '';
      if (notes !== rittNotes) {
        v.obj.m.k = k;
        if (notes) { k['Notes'] = notes; } else { delete k['Notes']; }
        v.dirty = true;
      }
      newLinks[String(v.id)] = { t: result, n: notes };
      return { tags: result, notes };
    };
    filePairs.forEach((f, v) => {
      const r = mergeLink(v, f.tags, f.notes);
      if (f.tags === null || !sameSet(r.tags, mapKeys(f.tags) || []) || (f.notes || '') !== r.notes) { res.stats.toVha++; }
      res.files.push({ hash: f.hash, tags: r.tags, notes: r.notes });
    });
    folderPairs.forEach((f, v) => {
      const r = mergeLink(v, f.tags, null);
      res.folders.push({ path: f.path, tags: r.tags });
    });
    Object.keys(baseLinks).forEach(k => { if (!(k in newLinks) && all.has(Number(k))) { newLinks[k] = baseLinks[k]; } });

    // ---------- the tree after the sync ----------
    const newTags: Record<string, any> = {};
    const newOrder: Record<string, number[]> = {};
    const walk = (pid: number, parentOut: number | null, seen: Set<number>) => {
      const kids = ids(all.get(pid).obj.c).filter(cid => isTag(cid) && !seen.has(cid));
      newOrder[String(pid)] = kids;
      kids.forEach(cid => {
        seen.add(cid);
        const v = all.get(cid);
        const p = propsOf(v);
        res.tags.push({ rittId: cid, key: rittToKey.get(cid), parentRittId: parentOut, pending: !!v.isNew, ...p });
        newTags[String(cid)] = { ...p, parent: pid };
        walk(cid, cid, seen);
      });
    };
    walk(tagRoot.id, null, new Set<number>());

    // ---------- write ----------
    const changed = Array.from(all.values()).filter(v => v.dirty);
    if (changed.length || deleted.length) {
      if (res.rittRunning) {
        res.ok = true;
        res.error = 'ritt-running';
        return res;
      }
      if (fs.statSync(req.rittFile).mtimeMs !== stamp) {
        throw new Error('Plik .ritt zmienił się w trakcie synchronizacji — spróbuj jeszcze raz');
      }
      fs.mkdirSync(req.backupDir, { recursive: true });
      const backup = path.join(req.backupDir, path.basename(req.rittFile, '.ritt') + '_' + new Date().toISOString().replace(/[:.]/g, '-') + '.ritt');
      fs.copyFileSync(req.rittFile, backup);
      res.backup = backup;
      const olds = fs.readdirSync(req.backupDir).filter((f: string) => f.endsWith('.ritt')).sort();
      olds.slice(0, Math.max(0, olds.length - 10)).forEach((f: string) => { try { fs.unlinkSync(path.join(req.backupDir, f)); } catch { } });

      db.run('BEGIN');
      const up = db.prepare('INSERT OR REPLACE INTO RittMainGraph (ID, Name, Content) VALUES (?, ?, ?)');
      changed.forEach(v => up.run([v.id, v.name, JSON.stringify(v.obj)]));
      up.free();
      const del = db.prepare('DELETE FROM RittMainGraph WHERE ID = ?');
      deleted.forEach(id => del.run([id]));
      del.free();
      updateRittMetadata(db);
      db.run('COMMIT');

      const tmp = req.rittFile + '.vha-tmp';
      fs.writeFileSync(tmp, Buffer.from(db.export()));
      fs.renameSync(tmp, req.rittFile);
      res.wroteRitt = true;
      res.tags.forEach(t => { t.pending = false; });
    }

    res.snapshot = { file: req.stateFile, data: { v: 2, rittFile: req.rittFile, at: Date.now(), tags: newTags, order: newOrder, links: newLinks } };
    res.mtime = rittMtime(req.rittFile);
    res.ok = true;
  } catch (e) {
    res.ok = false;
    res.error = (e && e.message) ? e.message : String(e);
  } finally {
    try { if (db) { db.close(); } } catch { }
  }
  return res;
}

export function commitRittSnapshot(snap: { file: string, data: any }): void {
  fs.mkdirSync(path.dirname(snap.file), { recursive: true });
  const tmp = snap.file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(snap.data));
  fs.renameSync(tmp, snap.file);
}

/**
 * Ritt keeps an MD5 of its content in RittMetadata (ID 300):
 * md5( meta100 + "\r\n" + meta200 + "\r\n" + all RittMainGraph.Content ordered by ID, joined by "\r\n" ), upper-case hex,
 * and the time of the last change in ID 400 (.NET ticks).
 */
function updateRittMetadata(db: any): void {
  try {
    const r = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='RittMetadata'");
    if (!r.length || !r[0].values.length) { return; }
  } catch { return; }
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
    db.run('UPDATE RittMetadata SET Content = ? WHERE ID = 400', [String(Date.now() + 62135596800000) + '0000']);
  }
}
