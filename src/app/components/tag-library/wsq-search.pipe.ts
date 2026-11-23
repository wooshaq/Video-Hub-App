import type { PipeTransform } from '@angular/core';
import { Pipe } from '@angular/core';

import { TagLibraryService } from './tag-library.service';

import type { ImageElement } from '../../../../interfaces/final-object.interface';

interface Term {
  neg: boolean;
  text: string;
  re: RegExp | null;   // when the term has * or ?
}

/**
 * WsQ search box: words are AND-ed, `OR` (or `|`) starts an alternative group,
 * `-word` / `NOT word` excludes, "quoted phrases" stay together, `*` and `?` are wildcards.
 * Searches the file name, the folder path and the tags (direct + inherited).
 */
@Pipe({
  standalone: false,
  name: 'wsqSearchPipe'
})
export class WsqSearchPipe implements PipeTransform {

  private cacheQuery = '';
  private cacheGroups: Term[][] = [];

  constructor(private lib: TagLibraryService) { }

  transform(items: ImageElement[], query: string, version?: number): ImageElement[] {
    const q = (query || '').trim();
    if (!q) {
      return items;
    }
    const groups = this.parse(q);
    if (!groups.length) {
      return items;
    }
    return items.filter(item => {
      if (item.cleanName === '*FOLDER*') {
        return true;
      }
      const hay = (
        item.fileName + '\u0001' + item.partialPath + '\u0001' + Array.from(this.lib.getEffective(item).all).join('\u0001')
      ).toLowerCase();
      return groups.some(g => g.every(t => {
        const hit = t.re ? t.re.test(hay) : hay.includes(t.text);
        return t.neg ? !hit : hit;
      }));
    });
  }

  private parse(q: string): Term[][] {
    if (q === this.cacheQuery) {
      return this.cacheGroups;
    }
    const tokens: string[] = [];
    const re = /"([^"]*)"|(\S+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(q)) !== null) {
      tokens.push(m[1] !== undefined ? '"' + m[1] : m[2]);
    }
    const groups: Term[][] = [[]];
    let negNext = false;
    tokens.forEach(tok => {
      const upper = tok.toUpperCase();
      if (upper === 'OR' || tok === '|') {
        groups.push([]);
        return;
      }
      if (upper === 'AND' || tok === '&') {
        return;
      }
      if (upper === 'NOT') {
        negNext = true;
        return;
      }
      let neg = negNext;
      negNext = false;
      let text = tok;
      if (text.startsWith('"')) {
        text = text.slice(1);
      } else if (text.length > 1 && text.startsWith('-')) {
        neg = true;
        text = text.slice(1);
      }
      text = text.toLowerCase();
      if (!text) {
        return;
      }
      let rx: RegExp | null = null;
      if (/[*?]/.test(text)) {
        const pattern = text.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^\\u0001]*').replace(/\?/g, '[^\\u0001]');
        rx = new RegExp(pattern);
      }
      groups[groups.length - 1].push({ neg, text, re: rx });
    });
    this.cacheQuery = q;
    this.cacheGroups = groups.filter(g => g.length);
    return this.cacheGroups;
  }

}
