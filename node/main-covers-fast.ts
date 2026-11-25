/**
 * WsQ: fast cover reading without starting ffprobe / ffmpeg.
 *   - MKV: the Attachments element is found through the SeekHead (or before the first Cluster)
 *     and only the bytes of the chosen picture are read
 *   - MP4 / M4V / MOV: moov > udta > meta > ilst > covr
 * Pictures are scaled with Electron's nativeImage (JPEG / PNG). Anything this code cannot read
 * returns `undefined`, and the old ffmpeg way is used.
 */

const fs = require('fs');
const { nativeImage } = require('electron');

export interface FastPicture {
  data: Buffer;
  ext: string;   // '.jpg' | '.png' | '.webp' | ...
}

/** picture found / no picture in the file (`null`) / could not tell (`undefined`) */
export type FastResult = FastPicture | null | undefined;

const MAX_PIC = 32 * 1024 * 1024;

class Reader {
  constructor(private fd: number, public size: number) { }
  read(pos: number, len: number): Buffer {
    len = Math.max(0, Math.min(len, this.size - pos));
    const buf = Buffer.alloc(len);
    let got = 0;
    while (got < len) {
      const n = fs.readSync(this.fd, buf, got, len - got, pos + got);
      if (n <= 0) { break; }
      got += n;
    }
    return got === len ? buf : buf.subarray(0, got);
  }
}

export function readCoverFast(fullPath: string): FastResult {
  const lower = fullPath.toLowerCase();
  const isMkv = /\.(mkv|mka|webm|mk3d)$/.test(lower);
  const isMp4 = /\.(mp4|m4v|mov|m4a|3gp)$/.test(lower);
  if (!isMkv && !isMp4) {
    return undefined;
  }
  let fd: number;
  try {
    fd = fs.openSync(fullPath, 'r');
    const r = new Reader(fd, fs.fstatSync(fd).size);
    const head = r.read(0, 12);
    if (head.length >= 4 && head.readUInt32BE(0) === 0x1A45DFA3) {
      return mkvCover(r);
    }
    if (head.length >= 8 && ['ftyp', 'moov', 'mdat', 'free', 'wide', 'skip'].includes(head.toString('latin1', 4, 8))) {
      return mp4Cover(r);
    }
    return undefined;
  } catch (e) {
    return undefined;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { } }
  }
}

// =====================================================================================================================
//   MKV (EBML)
// =====================================================================================================================

const ID_SEGMENT = 0x18538067;
const ID_SEEKHEAD = 0x114D9B74;
const ID_SEEK = 0x4DBB;
const ID_SEEKID = 0x53AB;
const ID_SEEKPOS = 0x53AC;
const ID_ATTACHMENTS = 0x1941A469;
const ID_ATTACHEDFILE = 0x61A7;
const ID_FILENAME = 0x466E;
const ID_FILEMIME = 0x4660;
const ID_FILEDATA = 0x465C;
const ID_CLUSTER = 0x1F43B675;

interface El { id: number; size: number; data: number; end: number; unknown: boolean; }

/** element header at `pos` of `buf` (positions relative to `base` in the file) */
function elAt(buf: Buffer, off: number, base: number): El | null {
  if (off >= buf.length) { return null; }
  const b0 = buf[off];
  let idLen = 1;
  while (idLen <= 4 && !(b0 & (0x80 >> (idLen - 1)))) { idLen++; }
  if (idLen > 4 || off + idLen >= buf.length) { return null; }
  let id = 0;
  for (let i = 0; i < idLen; i++) { id = id * 256 + buf[off + i]; }
  const s0 = buf[off + idLen];
  let sLen = 1;
  while (sLen <= 8 && !(s0 & (0x80 >> (sLen - 1)))) { sLen++; }
  if (sLen > 8 || off + idLen + sLen > buf.length) { return null; }
  let size = s0 & (0xFF >> sLen);
  let allOnes = size === (0xFF >> sLen);
  for (let i = 1; i < sLen; i++) {
    const b = buf[off + idLen + i];
    size = size * 256 + b;
    allOnes = allOnes && b === 0xFF;
  }
  const data = base + off + idLen + sLen;
  return { id, size, data, end: allOnes ? -1 : data + size, unknown: allOnes };
}

function uintOf(buf: Buffer): number {
  let v = 0;
  for (let i = 0; i < buf.length; i++) { v = v * 256 + buf[i]; }
  return v;
}

function mkvCover(r: Reader): FastResult {
  // EBML header, then the Segment
  const head = r.read(0, 4096);
  const ebml = elAt(head, 0, 0);
  if (!ebml || ebml.unknown) { return undefined; }
  const segHead = r.read(ebml.end, 16);
  const seg = elAt(segHead, 0, ebml.end);
  if (!seg || seg.id !== ID_SEGMENT) { return undefined; }
  const segStart = seg.data;
  const segEnd = seg.unknown ? r.size : Math.min(r.size, seg.end);

  const seekPositions: number[] = [];
  const seekHeadsDone = new Set<number>();
  let sawSeekHead = false;
  let attachPos = -1;

  const readSeekHead = (pos: number, size: number) => {
    if (seekHeadsDone.has(pos) || size > 1024 * 1024) { return; }
    seekHeadsDone.add(pos);
    sawSeekHead = true;
    const body = r.read(pos, size);
    let off = 0;
    while (off < body.length) {
      const e = elAt(body, off, pos);
      if (!e || e.unknown) { break; }
      if (e.id === ID_SEEK) {
        const sb = body.subarray(e.data - pos, e.end - pos);
        let so = 0;
        let sid = 0;
        let spos = -1;
        while (so < sb.length) {
          const c = elAt(sb, so, 0);
          if (!c || c.unknown) { break; }
          const v = sb.subarray(c.data, c.end);
          if (c.id === ID_SEEKID) { sid = uintOf(v); }
          if (c.id === ID_SEEKPOS) { spos = uintOf(v); }
          so = c.end;
        }
        if (spos >= 0) {
          if (sid === ID_ATTACHMENTS) { attachPos = segStart + spos; }
          if (sid === ID_SEEKHEAD) { seekPositions.push(segStart + spos); }
        }
      }
      off = e.end - pos;
    }
  };

  // top-level elements up to the first Cluster
  let pos = segStart;
  let reachedCluster = false;
  for (let n = 0; n < 256 && pos < segEnd; n++) {
    const h = elAt(r.read(pos, 16), 0, pos);
    if (!h) { break; }
    if (h.id === ID_CLUSTER) { reachedCluster = true; break; }
    if (h.id === ID_SEEKHEAD && !h.unknown) { readSeekHead(h.data, h.size); }
    if (h.id === ID_ATTACHMENTS && !h.unknown) { attachPos = pos; break; }
    if (h.unknown) { break; }
    pos = h.end;
  }
  // a SeekHead can point to a second one (at the end of the file)
  for (let i = 0; i < seekPositions.length && i < 4 && attachPos < 0; i++) {
    const h = elAt(r.read(seekPositions[i], 16), 0, seekPositions[i]);
    if (h && h.id === ID_SEEKHEAD && !h.unknown) { readSeekHead(h.data, h.size); }
  }

  if (attachPos < 0) {
    // no attachments listed in the index and none before the video data -> no cover
    return (sawSeekHead || reachedCluster || pos >= segEnd) ? null : undefined;
  }

  const ah = elAt(r.read(attachPos, 16), 0, attachPos);
  if (!ah || ah.id !== ID_ATTACHMENTS || ah.unknown) { return undefined; }

  // list the attached files without reading their data
  const files: { name: string, mime: string, pos: number, size: number }[] = [];
  let p = ah.data;
  for (let n = 0; n < 512 && p < ah.end; n++) {
    const f = elAt(r.read(p, 16), 0, p);
    if (!f || f.unknown) { break; }
    if (f.id === ID_ATTACHEDFILE) {
      let q = f.data;
      const item = { name: '', mime: '', pos: -1, size: 0 };
      for (let k = 0; k < 32 && q < f.end; k++) {
        const c = elAt(r.read(q, 16), 0, q);
        if (!c || c.unknown) { break; }
        if (c.id === ID_FILENAME && c.size < 4096) { item.name = r.read(c.data, c.size).toString('utf8'); }
        if (c.id === ID_FILEMIME && c.size < 256) { item.mime = r.read(c.data, c.size).toString('latin1').toLowerCase(); }
        if (c.id === ID_FILEDATA) { item.pos = c.data; item.size = c.size; }
        q = c.end;
      }
      if (item.pos >= 0 && item.mime.startsWith('image/')) {
        files.push(item);
      }
    }
    p = f.end;
  }
  if (!files.length) {
    return null;
  }
  const prio = (name: string) => {
    const l = name.toLowerCase();
    if (l.startsWith('cover_land')) { return 0; }
    if (l.startsWith('cover.') || l === 'cover') { return 1; }
    if (l.includes('cover') && !l.startsWith('small_cover')) { return 2; }
    if (l.startsWith('small_cover')) { return 6; }
    return 5;
  };
  files.sort((a, b) => prio(a.name) - prio(b.name));
  const best = files[0];
  if (best.size <= 0 || best.size > MAX_PIC) { return undefined; }
  const data = r.read(best.pos, best.size);
  if (data.length !== best.size) { return undefined; }
  const ext = best.mime.includes('png') ? '.png' : best.mime.includes('webp') ? '.webp' : '.jpg';
  return { data, ext };
}

// =====================================================================================================================
//   MP4 / MOV (ISO boxes)
// =====================================================================================================================

interface Box { type: string; start: number; data: number; end: number; }

function boxesIn(r: Reader, from: number, to: number, max = 512): Box[] {
  const out: Box[] = [];
  let pos = from;
  for (let n = 0; n < max && pos + 8 <= to; n++) {
    const h = r.read(pos, 16);
    if (h.length < 8) { break; }
    let size = h.readUInt32BE(0);
    const type = h.toString('latin1', 4, 8);
    let hdr = 8;
    if (size === 1) {
      if (h.length < 16) { break; }
      size = Number(h.readBigUInt64BE(8));
      hdr = 16;
    } else if (size === 0) {
      size = to - pos;
    }
    if (size < hdr) { break; }
    out.push({ type, start: pos, data: pos + hdr, end: Math.min(to, pos + size) });
    pos += size;
  }
  return out;
}

function mp4Cover(r: Reader): FastResult {
  const top = boxesIn(r, 0, r.size, 4096);
  const moov = top.find(b => b.type === 'moov');
  if (!moov) { return undefined; }
  const inMoov = boxesIn(r, moov.data, moov.end, 4096);
  if (inMoov.filter(b => b.type === 'trak').length > 2) {
    return undefined;   // extra tracks -- the cover may be a picture track, let ffprobe decide
  }
  const metas: Box[] = [];
  const udta = inMoov.find(b => b.type === 'udta');
  if (udta) { metas.push(...boxesIn(r, udta.data, udta.end).filter(b => b.type === 'meta')); }
  metas.push(...inMoov.filter(b => b.type === 'meta'));
  for (const meta of metas) {
    // 'meta' is a full box (4 bytes version / flags) in MP4, a plain one in QuickTime
    let kids = boxesIn(r, meta.data + 4, meta.end);
    if (!kids.some(b => b.type === 'ilst' || b.type === 'hdlr')) {
      kids = boxesIn(r, meta.data, meta.end);
    }
    const ilst = kids.find(b => b.type === 'ilst');
    if (!ilst) { continue; }
    const covr = boxesIn(r, ilst.data, ilst.end).find(b => b.type === 'covr');
    if (!covr) { continue; }
    const dataBox = boxesIn(r, covr.data, covr.end).find(b => b.type === 'data');
    if (!dataBox) { continue; }
    const kindBuf = r.read(dataBox.data, 8);
    if (kindBuf.length < 8) { return undefined; }
    const kind = kindBuf.readUInt32BE(0) & 0xFFFFFF;
    const len = dataBox.end - dataBox.data - 8;
    if (len <= 0 || len > MAX_PIC) { return undefined; }
    const data = r.read(dataBox.data + 8, len);
    const ext = kind === 14 ? '.png' : kind === 27 ? '.bmp' : '.jpg';
    return { data, ext };
  }
  return null;
}

// =====================================================================================================================
//   Scaling
// =====================================================================================================================

/** JPEG of at most `maxW` px wide, or null when nativeImage cannot read the picture (webp, ...) */
export function scaledJpeg(pic: FastPicture, maxW: number): Buffer | null {
  try {
    const img = nativeImage.createFromBuffer(pic.data);
    if (img.isEmpty()) {
      return null;
    }
    const size = img.getSize();
    if (size.width <= maxW && pic.ext === '.jpg') {
      return pic.data;   // already small enough -- keep the original bytes
    }
    const out = size.width > maxW ? img.resize({ width: maxW, quality: 'best' }) : img;
    const jpg: Buffer = out.toJPEG(88);
    return jpg && jpg.length ? jpg : null;
  } catch (e) {
    return null;
  }
}
