/**
 * Cover art from file metadata (WsQ):
 *   - MKV attachments with an image mimetype (cover_land.jpg, cover.jpg, small_cover.jpg, ...)
 *   - attached pictures (MP4/M4V `covr`, MKV/MP3 style attached_pic streams)
 * The cover is saved as `vha-<hub>/covers/<hash>.jpg` (max 960 px wide) and becomes the main thumbnail.
 */

import * as path from 'path';
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

const ffmpegPath = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
const ffprobePath = require('@ffprobe-installer/ffprobe').path.replace('app.asar', 'app.asar.unpacked');

interface CoverCandidate {
  index: number;
  kind: 'attachment' | 'attached_pic';
  fileName: string;
  ext: string;
  priority: number;   // lower = better
}

function run(cmd: string, args: string[], timeout: number): Promise<{ stdout: string, stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        reject(err);
      } else {
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      }
    });
  });
}

/** which streams of the file are cover images */
async function findCovers(fullPath: string): Promise<CoverCandidate[]> {
  const { stdout } = await run(ffprobePath, ['-v', 'quiet', '-of', 'json', '-show_streams', fullPath], 180000);
  const data = JSON.parse(stdout || '{}');
  const out: CoverCandidate[] = [];
  (data.streams || []).forEach((st: any) => {
    const tags = st.tags || {};
    const mimetype: string = (tags.mimetype || tags.MIMETYPE || '').toLowerCase();
    const fileName: string = tags.filename || tags.FILENAME || '';
    if (st.codec_type === 'attachment' && mimetype.startsWith('image/')) {
      const lower = fileName.toLowerCase();
      let priority = 5;
      if (lower.startsWith('cover_land')) {
        priority = 0;
      } else if (lower.startsWith('cover.') || lower === 'cover') {
        priority = 1;
      } else if (lower.includes('cover') && !lower.startsWith('small_cover')) {
        priority = 2;
      } else if (lower.startsWith('small_cover')) {
        priority = 6;
      }
      const ext = mimetype.includes('png') ? '.png' : mimetype.includes('webp') ? '.webp' : '.jpg';
      out.push({ index: st.index, kind: 'attachment', fileName, ext, priority });
    } else if (st.codec_type === 'video' && st.disposition && st.disposition.attached_pic === 1) {
      out.push({ index: st.index, kind: 'attached_pic', fileName: '', ext: '.jpg', priority: 3 });
    }
  });
  return out.sort((a, b) => a.priority - b.priority || a.index - b.index);
}

/**
 * Extract the best cover of a video into `coversDir/<hash>.jpg`
 * @returns true if the file has a cover (and it was saved)
 */
// WsQ: one extraction per file at a time -- the cover queue and the thumbnail queue could both ask for the same file,
// and two ffmpeg runs on the same temp / target file made one of them report "no cover"
const inFlight = new Map<string, Promise<boolean | null>>();

export function extractCover(fullPath: string, hash: string, coversDir: string): Promise<boolean | null> {
  const running = inFlight.get(hash);
  if (running) {
    return running;
  }
  const p = extractCoverOnce(fullPath, hash, coversDir).finally(() => inFlight.delete(hash));
  inFlight.set(hash, p);
  return p;
}

async function extractCoverOnce(fullPath: string, hash: string, coversDir: string): Promise<boolean | null> {
  const target = path.join(coversDir, hash + '.jpg');
  let candidates: CoverCandidate[] = [];
  try {
    candidates = await findCovers(fullPath);
  } catch (e) {
    return null;   // WsQ: could not read the file now (busy disk, timeout) -- unknown, not "no cover"
  }

  if (!candidates.length) {
    try { fs.unlinkSync(target); } catch { }
    return false;
  }

  if (!fs.existsSync(coversDir)) {
    fs.mkdirSync(coversDir, { recursive: true });
  }

  let failed = false;
  const scale = ['-vf', 'scale=w=min(960\\,iw):h=-2', '-q:v', '3', '-frames:v', '1'];

  for (const c of candidates) {
    try {
      if (c.kind === 'attached_pic') {
        await run(ffmpegPath, ['-y', '-v', 'error', '-i', fullPath, '-map', '0:' + c.index, ...scale, target], 180000);
      } else {
        // dump the attachment to a temp file, then convert / scale it to jpg
        const tmp = path.join(os.tmpdir(), 'vha-cover-' + hash + '-' + c.index + c.ext);
        try { fs.unlinkSync(tmp); } catch { }
        try {
          await run(ffmpegPath, ['-y', '-v', 'error', '-dump_attachment:' + c.index, tmp, '-i', fullPath, '-t', '0', '-f', 'null', '-'], 180000);
        } catch {
          // ffmpeg exits with an error when there is no output, but the attachment is dumped anyway
        }
        if (!fs.existsSync(tmp)) {
          continue;
        }
        await run(ffmpegPath, ['-y', '-v', 'error', '-i', tmp, ...scale, target], 180000);
        try { fs.unlinkSync(tmp); } catch { }
      }
      if (fs.existsSync(target) && fs.statSync(target).size > 0) {
        return true;
      }
    } catch (e) {
      failed = true;   // try the next candidate
    }
  }
  return failed ? null : false;
}
