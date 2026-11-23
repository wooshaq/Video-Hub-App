/**
 * WsQ: custom folder icons (Windows desktop.ini -> IconResource / IconFile)
 *
 *   [.ShellClassInfo]
 *   IconResource=icons\jav.ico,0
 *
 * Only image files are returned (.ico .png .jpg .jpeg .bmp .gif .webp) -- icons inside .exe / .dll are skipped.
 */

const fs = require('fs');
import * as path from 'path';

const IMAGE_EXT = ['.ico', '.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp'];

function readIni(file: string): string {
  const buf: Buffer = fs.readFileSync(file);
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
    return buf.slice(2).toString('utf16le');
  }
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    return buf.slice(3).toString('utf8');
  }
  // no BOM: UTF-16 without BOM has many zero bytes
  let zeros = 0;
  for (let i = 1; i < Math.min(buf.length, 200); i += 2) {
    if (buf[i] === 0) {
      zeros++;
    }
  }
  if (zeros > 20) {
    return buf.toString('utf16le');
  }
  const asUtf8 = buf.toString('utf8');
  return asUtf8.includes('�') ? buf.toString('latin1') : asUtf8;
}

function expandEnv(p: string): string {
  return p.replace(/%([^%]+)%/g, (m, name) => {
    const key = Object.keys(process.env).find(k => k.toLowerCase() === String(name).toLowerCase());
    return key ? (process.env[key] as string) : m;
  });
}

/** absolute path of the folder's custom icon image, or '' */
export function folderIconOf(folder: string): string {
  try {
    const ini = path.join(folder, 'desktop.ini');
    if (!fs.existsSync(ini)) {
      return '';
    }
    const text = readIni(ini);
    let value = '';
    let section = '';
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      const sec = /^\[(.+)\]$/.exec(line);
      if (sec) {
        section = sec[1].toLowerCase();
        continue;
      }
      if (section && section !== '.shellclassinfo' && !section.startsWith('viewstate')) {
        continue;
      }
      const kv = /^(IconResource|IconFile)\s*=\s*(.+)$/i.exec(line);
      if (kv && (!value || kv[1].toLowerCase() === 'iconresource')) {
        value = kv[2].trim();
      }
    }
    if (!value) {
      return '';
    }
    value = value.replace(/^"|"$/g, '').replace(/,\s*-?\d+\s*$/, '').trim();   // drop ",index"
    value = expandEnv(value);
    const abs = path.isAbsolute(value) ? value : path.join(folder, value);
    if (!IMAGE_EXT.includes(path.extname(abs).toLowerCase())) {
      return '';
    }
    return fs.existsSync(abs) ? abs : '';
  } catch (e) {
    return '';
  }
}

/**
 * WsQ: the icon as a data URL, trimmed to its visible (non-transparent) part, so a custom icon fills
 * the same box as the drawn folder. Falls back to the plain file path when the image cannot be read.
 */
export function folderIconData(folder: string): string {
  const file = folderIconOf(folder);
  if (!file) {
    return '';
  }
  try {
    const { nativeImage } = require('electron');
    const img = nativeImage.createFromPath(file);
    if (img.isEmpty()) {
      return file;
    }
    const { width, height } = img.getSize();
    const bmp: Buffer = img.toBitmap();   // BGRA, 4 bytes per pixel
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (bmp[(y * width + x) * 4 + 3] > 12) {
          if (x < minX) { minX = x; }
          if (x > maxX) { maxX = x; }
          if (y < minY) { minY = y; }
          if (y > maxY) { maxY = y; }
        }
      }
    }
    if (maxX < 0) {
      return file;
    }
    const cropped = (minX === 0 && minY === 0 && maxX === width - 1 && maxY === height - 1)
      ? img
      : img.crop({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 });
    return cropped.toDataURL();
  } catch (e) {
    return file;
  }
}
