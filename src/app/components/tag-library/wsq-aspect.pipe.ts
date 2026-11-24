import type { PipeTransform } from '@angular/core';
import { Pipe } from '@angular/core';

import { TagLibraryService } from './tag-library.service';
import { javKey } from './jav-code';

import type { ImageElement } from '../../../../interfaces/final-object.interface';

/**
 * WsQ: reporting pipe of the gallery -- passes the items through and reports them
 * (tile shape, view counts ...). In "duplicates" mode the last one also puts files with the same code next to each other.
 */
@Pipe({
  standalone: false,
  name: 'wsqAspectPipe'
})
export class WsqAspectPipe implements PipeTransform {

  constructor(private lib: TagLibraryService) { }

  transform(items: ImageElement[], report: (items: ImageElement[]) => void, version?: number, groupDups?: boolean): ImageElement[] {
    if (groupDups && this.lib.dupMode && Array.isArray(items)) {
      items = items.slice().sort((a, b) => {
        const ka = javKey(a.fileName);
        const kb = javKey(b.fileName);
        return ka < kb ? -1 : ka > kb ? 1 : (a.fileName || '').localeCompare(b.fileName || '');
      });
    }
    if (report && Array.isArray(items)) {
      report(items);
    }
    return items;
  }
}
