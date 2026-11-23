import type { PipeTransform } from '@angular/core';
import { Pipe } from '@angular/core';

import { TagLibraryService } from './tag-library.service';

import type { ImageElement } from '../../../../interfaces/final-object.interface';

@Pipe({
  standalone: false,
  name: 'tagLibraryFilterPipe'
})
export class TagLibraryFilterPipe implements PipeTransform {

  constructor(private lib: TagLibraryService) { }

  /**
   * Filter by the active Ritt-style tags (direct + inherited from folders)
   * @param finalArray
   * @param filterVersion -- changes whenever the filter or tag assignments change
   */
  transform(finalArray: ImageElement[], filterVersion: number): ImageElement[] {
    return this.lib.filter(finalArray);   // WsQ: related tags are computed from the final view (setViewItems)
  }

}
