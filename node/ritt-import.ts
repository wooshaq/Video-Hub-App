/**
 * Reading a Ritt database (*.ritt) -- ported from BetterCharaLoader's RittDatabase.cs (wooshaq).
 *
 * New Ritt versions keep an SQLite file with the table RittMainGraph (ID, Name, Content = JSON of one vertex).
 * Old versions keep the same JSON vertices, one per line (first two lines are metadata).
 *
 * Vertex JSON:  p = parents, c = children, t = tags of this vertex, l = vertices this tag is attached to,
 *               m.t = vertex type (0 space, 1 tag, 2 link), m.n = name, m.i = icon,
 *               m.c.t = content type (1 file, 2 folder, 3 task ...), m.c.id = id of a linked root folder,
 *               m.a = attributes {key: value}
 *
 * Minimal read-only SQLite reader (no native modules): rowid / WITHOUT ROWID tables, overflow pages,
 * UTF-8 / UTF-16 text and committed WAL frames (works while Ritt still has the database open).
 */

const fs = require('fs');

import type { RittImportData, RittLink, RittTag } from '../interfaces/ritt.interface';
export type { RittImportData, RittLink, RittTag };

// ------------------------------------------------------------------------------------------------
// Result sent to Angular
// ------------------------------------------------------------------------------------------------

// Attribute keys from the Ritt database documentation
const ATTR_HIDDEN = '2848';
const ATTR_ENCAPSULATE = '3217';
const ATTR_BADGE = '4626';
const ATTR_SEPARATOR = '4712';
const ATTR_HOTKEY = '5183';
const ATTR_INHERIT = '6245';   // "Dziedzicz" -- value = depth (found in a test database from the user)
const KNOWN_ATTRS = [ATTR_HIDDEN, ATTR_ENCAPSULATE, ATTR_BADGE, ATTR_SEPARATOR, ATTR_HOTKEY, ATTR_INHERIT, '35528', '50258', '54234'];
// m.k = named properties: { "Alias": "a;b", "Color": "#AARRGGBB;#AARRGGBB", ... }
const KNOWN_PROPS = ['Alias', 'Color'];

interface Vertex {
  id: number;
  name: string;
  type: number;           // m.t
  contentType: number;    // m.c.t
  connectionId: string;   // m.c.id
  icon: string;
  attrs: Record<string, any>;
  props: Record<string, any>;
  parents: number[];
  children: number[];
  tags: number[];
  links: number[];
}

// ------------------------------------------------------------------------------------------------
// Public entry point
// ------------------------------------------------------------------------------------------------

export function readRittDatabase(filePath: string): RittImportData {
  const result: RittImportData = { file: filePath, tags: [], links: [], unknownAttributes: [] };
  try {
    const vertices = new Map<number, Vertex>();
    const head = Buffer.alloc(16);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, head, 0, 16, 0);
    fs.closeSync(fd);

    if (head.toString('ascii', 0, 15) === 'SQLite format 3') {
      const reader = new SqliteReader(filePath);
      try {
        for (const row of reader.readTable('RittMainGraph')) {
          // columns: ID INTEGER PRIMARY KEY, Name TEXT, Content TEXT
          if (row.length < 3) {
            continue;
          }
          const json = typeof row[2] === 'string' ? row[2] : (Buffer.isBuffer(row[2]) ? row[2].toString('utf8') : null);
          const v = parseVertex(row[0], json);
          if (v) {
            vertices.set(v.id, v);
          }
        }
      } finally {
        reader.close();
      }
    } else {
      // old format: newline delimited JSON
      const lines: string[] = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
      lines.forEach(line => {
        line = line.trim();
        if (!line.startsWith('{') || line.indexOf('"m"') === -1) {
          return;
        }
        const v = parseVertex(null, line);
        if (v) {
          vertices.set(v.id, v);
        }
      });
    }

    build(vertices, result);
  } catch (e) {
    result.error = (e && e.message) ? e.message : String(e);
  }
  return result;
}

// ------------------------------------------------------------------------------------------------
// Graph -> tag tree + tagged links
// ------------------------------------------------------------------------------------------------

function parseVertex(idValue: any, json: string | null): Vertex | null {
  if (!json) {
    return null;
  }
  let obj: any;
  try {
    obj = JSON.parse(json);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') {
    return null;
  }
  const meta = obj.m || {};
  const content = meta.c || {};
  const id = typeof idValue === 'number' ? idValue : toNumber(obj.i);
  return {
    id,
    name: typeof meta.n === 'string' ? meta.n : '',
    type: toNumber(meta.t),
    contentType: toNumber(content.t),
    connectionId: typeof content.id === 'string' ? content.id : '',
    icon: typeof meta.i === 'string' ? meta.i : '',
    attrs: (meta.a && typeof meta.a === 'object') ? meta.a : {},
    props: (meta.k && typeof meta.k === 'object') ? meta.k : {},
    parents: toIds(obj.p),
    children: toIds(obj.c),
    tags: toIds(obj.t),
    links: toIds(obj.l),
  };
}

function toNumber(v: any): number {
  if (typeof v === 'number') {
    return v;
  }
  if (typeof v === 'string' && /^-?\d+$/.test(v)) {
    return parseInt(v, 10);
  }
  return 0;
}

function toIds(v: any): number[] {
  return Array.isArray(v) ? v.map(toNumber) : [];
}

function truthy(v: any): boolean {
  return v === true || (typeof v === 'number' && v !== 0) || (typeof v === 'string' && v !== '' && v !== '0' && v.toLowerCase() !== 'false');
}

/** an icon is kept only if it looks like an emoji / short text (not a path to a GIF) */
function cleanIcon(icon: string): string {
  if (!icon) {
    return '';
  }
  if (icon.length > 16 || /[\\/]|\.(gif|png|jpe?g|webp)$/i.test(icon)) {
    return '';
  }
  return icon;
}

/** "#AARRGGBB;#AARRGGBB" (or "#RRGGBB") -> first colour as #RRGGBB */
function colorOf(v: any): string {
  if (typeof v !== 'string') {
    return '';
  }
  const first = v.split(';')[0].trim();
  let m = /^#?([0-9a-f]{2})([0-9a-f]{6})$/i.exec(first);
  if (m) {
    return m[1].toLowerCase() === '00' ? '' : '#' + m[2].toUpperCase();
  }
  m = /^#?([0-9a-f]{6})$/i.exec(first);
  return m ? '#' + m[1].toUpperCase() : '';
}

function aliasesOf(v: any): string[] {
  if (Array.isArray(v)) {
    return v.map(x => String(x).trim()).filter(Boolean);
  }
  if (typeof v !== 'string') {
    return [];
  }
  return v.split(/[;,\n]/).map(x => x.trim()).filter(Boolean);
}

function notesOf(props: Record<string, any>): string {
  const key = Object.keys(props).find(k => /note|notatk|desc|comment/i.test(k));
  return key && typeof props[key] === 'string' ? props[key] : '';
}

/** Ritt "Dziedzicz": number = depth; very large / negative = all levels */
function inheritOf(v: any): number | null | undefined {
  if (v === undefined || v === null || v === false) {
    return undefined;
  }
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!isFinite(n)) {
    return v === true ? null : undefined;
  }
  if (n < 0 || n >= 100) {
    return null;
  }
  return Math.round(n);
}

function hotkeyOf(v: any): string {
  if (v === undefined || v === null || v === false) {
    return '';
  }
  const n = typeof v === 'number' ? Math.round(v) : toNumber(v);
  if (typeof v === 'string' && /^[0-9]$/.test(v)) {
    return v;
  }
  if (n >= 0 && n <= 9) {
    return String(n);
  }
  if (n === 10) {
    return '0';
  }
  return '';
}

function build(vertices: Map<number, Vertex>, result: RittImportData): void {
  const unknown = new Set<string>();

  // ---------- tags ----------
  const placed = new Set<number>();
  const buildTag = (id: number, visiting: Set<number>): RittTag | null => {
    const v = vertices.get(id);
    if (!v || v.type !== 1 || visiting.has(id) || placed.has(id)) {
      return null;
    }
    placed.add(id);
    visiting.add(id);
    Object.keys(v.attrs).forEach(k => { if (!KNOWN_ATTRS.includes(k)) { unknown.add(k); } });
    Object.keys(v.props).forEach(k => { if (!KNOWN_PROPS.includes(k) && !/note|notatk|desc|comment/i.test(k)) { unknown.add('k:' + k); } });
    const tag: RittTag = {
      id,
      name: v.name,
      icon: cleanIcon(v.icon),
      hidden: truthy(v.attrs[ATTR_HIDDEN]),
      encapsulate: truthy(v.attrs[ATTR_ENCAPSULATE]),
      badge: truthy(v.attrs[ATTR_BADGE]),
      separator: truthy(v.attrs[ATTR_SEPARATOR]),
      hotkey: hotkeyOf(v.attrs[ATTR_HOTKEY]),
      aliases: aliasesOf(v.props['Alias']),
      color: colorOf(v.props['Color']),
      notes: notesOf(v.props),
      inherit: inheritOf(v.attrs[ATTR_INHERIT]),
      children: [],
    };
    v.children.forEach(c => {
      const child = buildTag(c, visiting);
      if (child) {
        tag.children.push(child);
      }
    });
    visiting.delete(id);
    return tag;
  };

  // roots: tag vertices without parents (the 🏷 "root tag" container) -- show their children
  const roots = Array.from(vertices.values()).filter(v => v.type === 1 && v.parents.length === 0).sort((a, b) => a.id - b.id);
  roots.forEach(root => {
    placed.add(root.id);
    root.children.forEach(c => {
      const t = buildTag(c, new Set<number>([root.id]));
      if (t) {
        result.tags.push(t);
      }
    });
  });

  // ---------- tagged files / folders ----------
  const tagIds = new Set<number>();
  const walkIds = (tags: RittTag[]) => tags.forEach(t => { tagIds.add(t.id); walkIds(t.children); });
  walkIds(result.tags);

  const linkTags = new Map<number, Set<number>>();
  const addLinkTag = (linkId: number, tagId: number) => {
    if (!tagIds.has(tagId)) {
      return;
    }
    if (!linkTags.has(linkId)) {
      linkTags.set(linkId, new Set<number>());
    }
    linkTags.get(linkId).add(tagId);
  };
  vertices.forEach(v => {
    if (v.type === 1) {
      v.links.forEach(l => addLinkTag(l, v.id));
    } else if (v.type === 2) {
      v.tags.forEach(t => addLinkTag(v.id, t));
    }
  });

  linkTags.forEach((tags, linkId) => {
    const v = vertices.get(linkId);
    if (!v || v.type !== 2 || (v.contentType !== 1 && v.contentType !== 2)) {
      return; // tasks etc. are not imported
    }
    result.links.push({
      kind: v.contentType === 1 ? 'file' : 'folder',
      path: relativePathOf(v, vertices),
      tags: Array.from(tags),
    });
  });

  result.unknownAttributes = Array.from(unknown);
}

/** Folder chain below the Ritt root folder (the one with a connection id), root itself left out */
function relativePathOf(v: Vertex, vertices: Map<number, Vertex>): string[] {
  if (v.connectionId) {
    return []; // the linked root folder itself
  }
  const parts = [v.name];
  let current = v;
  let guard = 0;
  while (current.parents.length > 0 && guard++ < 64) {
    const parent = vertices.get(current.parents[0]);
    if (!parent || parent.type !== 2 || parent.contentType !== 2) {
      break;
    }
    if (parent.connectionId) {
      break; // reached the linked root folder
    }
    parts.unshift(parent.name);
    current = parent;
  }
  return parts;
}

// ------------------------------------------------------------------------------------------------
// Minimal SQLite reader
// ------------------------------------------------------------------------------------------------

class SqliteReader {

  private fd: number;
  private walFd = -1;
  private pageSize: number;
  private usableSize: number;
  private encoding: 'utf8' | 'utf16le' | 'utf16be';
  private walPages = new Map<number, number>();  // page number -> offset in the wal file

  constructor(private path: string) {
    this.fd = fs.openSync(path, 'r');
    const header = Buffer.alloc(100);
    fs.readSync(this.fd, header, 0, 100, 0);
    if (header.toString('ascii', 0, 15) !== 'SQLite format 3') {
      throw new Error('Not an SQLite database');
    }
    this.pageSize = header.readUInt16BE(16);
    if (this.pageSize === 1) {
      this.pageSize = 65536;
    }
    this.usableSize = this.pageSize - header[20];
    const enc = header.readUInt32BE(56);
    this.encoding = enc === 2 ? 'utf16le' : enc === 3 ? 'utf16be' : 'utf8';
    try {
      if (fs.existsSync(path + '-wal')) {
        this.walFd = fs.openSync(path + '-wal', 'r');
        this.indexWal();
      }
    } catch {
      this.walPages.clear();
    }
  }

  close(): void {
    try { fs.closeSync(this.fd); } catch { }
    if (this.walFd >= 0) {
      try { fs.closeSync(this.walFd); } catch { }
    }
  }

  private indexWal(): void {
    const header = Buffer.alloc(32);
    if (fs.readSync(this.walFd, header, 0, 32, 0) !== 32) {
      return;
    }
    const magic = header.readUInt32BE(0);
    if (magic !== 0x377f0682 && magic !== 0x377f0683) {
      return;
    }
    if (header.readUInt32BE(8) !== this.pageSize) {
      return;
    }
    const salt1 = header.readUInt32BE(16);
    const salt2 = header.readUInt32BE(20);
    const size = fs.fstatSync(this.walFd).size;
    const frame = Buffer.alloc(24);
    const pending = new Map<number, number>();
    let offset = 32;
    while (offset + 24 + this.pageSize <= size) {
      if (fs.readSync(this.walFd, frame, 0, 24, offset) !== 24) {
        break;
      }
      if (frame.readUInt32BE(8) !== salt1 || frame.readUInt32BE(12) !== salt2) {
        break;
      }
      pending.set(frame.readUInt32BE(0), offset + 24);
      if (frame.readUInt32BE(4) !== 0) {   // commit frame
        pending.forEach((v, k) => this.walPages.set(k, v));
        pending.clear();
      }
      offset += 24 + this.pageSize;
    }
  }

  private readPage(n: number): Buffer {
    const page = Buffer.alloc(this.pageSize);
    if (this.walPages.has(n)) {
      fs.readSync(this.walFd, page, 0, this.pageSize, this.walPages.get(n));
    } else {
      fs.readSync(this.fd, page, 0, this.pageSize, (n - 1) * this.pageSize);
    }
    return page;
  }

  readTable(tableName: string): any[][] {
    let rootPage = -1;
    for (const row of this.readBTree(1)) {
      // sqlite_master: type, name, tbl_name, rootpage, sql
      if (row.length >= 5 && row[0] === 'table' && String(row[1]).toLowerCase() === tableName.toLowerCase()) {
        rootPage = typeof row[3] === 'number' ? row[3] : -1;
        break;
      }
    }
    if (rootPage <= 0) {
      throw new Error('Table ' + tableName + ' not found');
    }
    return this.readBTree(rootPage);
  }

  private readBTree(root: number): any[][] {
    const out: any[][] = [];
    this.walkPage(root, out, new Set<number>(), 0);
    return out;
  }

  private walkPage(n: number, out: any[][], visited: Set<number>, depth: number): void {
    if (n === 0 || depth > 64 || visited.has(n)) {
      return;
    }
    visited.add(n);
    const page = this.readPage(n);
    const start = n === 1 ? 100 : 0;
    const type = page[start];
    const cellCount = page.readUInt16BE(start + 3);
    const interior = type === 0x02 || type === 0x05;
    const headerSize = interior ? 12 : 8;
    for (let i = 0; i < cellCount; i++) {
      const cell = page.readUInt16BE(start + headerSize + i * 2);
      switch (type) {
        case 0x0D: {  // table leaf
          const p = { pos: cell };
          const payloadSize = readVarint(page, p);
          const rowId = readVarint(page, p);
          const rec = this.readRecord(this.readPayload(page, p.pos, payloadSize, false));
          if (rec.length > 0 && rec[0] === null) {
            rec[0] = rowId;   // INTEGER PRIMARY KEY is stored as NULL
          }
          out.push(rec);
          break;
        }
        case 0x05:    // table interior
          this.walkPage(page.readUInt32BE(cell), out, visited, depth + 1);
          break;
        case 0x0A: {  // index leaf
          const p = { pos: cell };
          const payloadSize = readVarint(page, p);
          out.push(this.readRecord(this.readPayload(page, p.pos, payloadSize, true)));
          break;
        }
        case 0x02: {  // index interior
          this.walkPage(page.readUInt32BE(cell), out, visited, depth + 1);
          const p = { pos: cell + 4 };
          const payloadSize = readVarint(page, p);
          out.push(this.readRecord(this.readPayload(page, p.pos, payloadSize, true)));
          break;
        }
        default:
          return;
      }
    }
    if (interior) {
      this.walkPage(page.readUInt32BE(start + 8), out, visited, depth + 1);
    }
  }

  private readPayload(page: Buffer, pos: number, size: number, index: boolean): Buffer {
    const u = this.usableSize;
    const maxLocal = index ? Math.floor((u - 12) * 64 / 255) - 23 : u - 35;
    const minLocal = Math.floor((u - 12) * 32 / 255) - 23;
    let local: number;
    if (size <= maxLocal) {
      local = size;
    } else {
      const k = minLocal + ((size - minLocal) % (u - 4));
      local = k <= maxLocal ? k : minLocal;
    }
    const result = Buffer.alloc(size);
    page.copy(result, 0, pos, Math.min(pos + local, page.length));
    if (local >= size) {
      return result;
    }
    let copied = local;
    let overflow = page.readUInt32BE(pos + local);
    let guard = 0;
    while (overflow !== 0 && copied < size && guard++ < 1000000) {
      const ov = this.readPage(overflow);
      const n = Math.min(u - 4, size - copied);
      ov.copy(result, copied, 4, 4 + n);
      copied += n;
      overflow = ov.readUInt32BE(0);
    }
    return result;
  }

  private readRecord(data: Buffer): any[] {
    const p = { pos: 0 };
    const headerSize = readVarint(data, p);
    const types: number[] = [];
    while (p.pos < headerSize) {
      types.push(readVarint(data, p));
    }
    const values: any[] = [];
    let pos = headerSize;
    for (const t of types) {
      switch (t) {
        case 0: values.push(null); break;
        case 1: values.push(data.readInt8(pos)); pos += 1; break;
        case 2: values.push(data.readInt16BE(pos)); pos += 2; break;
        case 3: values.push(data.readIntBE(pos, 3)); pos += 3; break;
        case 4: values.push(data.readInt32BE(pos)); pos += 4; break;
        case 5: values.push(data.readIntBE(pos, 6)); pos += 6; break;
        case 6: values.push(Number(data.readBigInt64BE(pos))); pos += 8; break;
        case 7: values.push(data.readDoubleBE(pos)); pos += 8; break;
        case 8: values.push(0); break;
        case 9: values.push(1); break;
        default:
          if (t >= 12 && t % 2 === 0) {
            const len = (t - 12) / 2;
            values.push(data.subarray(pos, pos + len));
            pos += len;
          } else if (t >= 13) {
            const len = (t - 13) / 2;
            const slice = data.subarray(pos, pos + len);
            if (this.encoding === 'utf16be') {
              const swapped = Buffer.from(slice);
              swapped.swap16();
              values.push(swapped.toString('utf16le'));
            } else {
              values.push(slice.toString(this.encoding));
            }
            pos += len;
          }
          break;
      }
    }
    return values;
  }
}

function readVarint(data: Buffer, p: { pos: number }): number {
  let v = 0;
  for (let i = 0; i < 8; i++) {
    const b = data[p.pos++];
    v = v * 128 + (b & 0x7F);
    if ((b & 0x80) === 0) {
      return v;
    }
  }
  return v * 256 + data[p.pos++];
}
