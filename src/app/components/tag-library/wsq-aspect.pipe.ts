import type { PipeTransform } from '@angular/core';
import { Pipe } from '@angular/core';

import type { ImageElement } from '../../../../interfaces/final-object.interface';

/**
 * WsQ: last pipe of the gallery -- passes the items through unchanged and
 * reports them, so the tile shape can follow what is on screen (covers vs. frames)
 */
@Pipe({
  standalone: false,
  name: 'wsqAspectPipe'
})
export class WsqAspectPipe implements PipeTransform {
  transform(items: ImageElement[], report: (items: ImageElement[]) => void, version?: number): ImageElement[] {
    if (report && Array.isArray(items)) {
      report(items);
    }
    return items;
  }
}
