/**
 * WsQ: JAV-style code from a file name -- "Alice Otsu - PPPE029 [u].mkv" -> PPPE-029
 * Codec / format tokens (H265, X264, MP4 ...) are skipped.
 */
const NOT_CODES = /^(H|X|HEVC|AVC|AAC|AC|DTS|MP|FLAC|DDP|DD|EAC|CH|BIT|HDR|FPS|VP|AV|S|E|PART|CD|DISC|VOL|EP)$/i;

export function javCode(fileName: string): string {
  const re = /(?:^|[^A-Za-z0-9])([A-Za-z]{2,6})-?(\d{2,5})(?![0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fileName || ''))) {
    if (!NOT_CODES.test(m[1])) {
      return m[1].toUpperCase() + '-' + m[2];
    }
  }
  return '';
}

/** key for comparing codes: PPPE-029, PPPE29 and pppe-0029 are the same film */
export function javKey(fileName: string): string {
  const c = javCode(fileName);
  if (!c) {
    return '';
  }
  const [letters, num] = c.split('-');
  return letters + '-' + String(parseInt(num, 10)).padStart(3, '0');
}
