import type { OnInit, ElementRef, OnDestroy } from '@angular/core';
import { Component, Input, input, output, viewChild } from '@angular/core';

import { FilePathService } from '../file-path.service';

import { metaAppear, textAppear } from '../../../common/animations';

import { ImageElementService } from './../../../services/image-element.service';
import type { ImageElement } from '../../../../../interfaces/final-object.interface';
import type { VideoClickEmit, RightClickEmit } from '../../../../../interfaces/shared-interfaces';

@Component({
  standalone: false,
  selector: 'app-thumbnail',
  templateUrl: './thumbnail.component.html',
  styleUrls: [
    '../clip-and-preview.scss',
    '../time-and-rez.scss',
    './thumbnail.component.scss',
    '../selected.scss'
  ],
  animations: [textAppear, metaAppear]
})
export class ThumbnailComponent implements OnInit, OnDestroy {

  readonly filmstripHolder = viewChild<ElementRef>('filmstripHolder');

  readonly refreshPlaylist = output<void>();
  readonly rightClick = output<RightClickEmit>();
  readonly sheetClick = output<void>();
  readonly videoClick = output<VideoClickEmit>();

  readonly heartPressed = output<void>();

  @Input() video: ImageElement;

  readonly compactView = input<boolean>();
  readonly connected = input<boolean>();
  readonly darkMode = input<boolean>();
  readonly elHeight = input<number>();
  readonly elWidth = input<number>();
  readonly folderPath = input<string>();
  readonly hoverScrub = input<boolean>();
  readonly hubName = input<string>();
  readonly imgHeight = input<number>();
  readonly largerFont = input<boolean>();
  readonly returnToFirstScreenshot = input<boolean>();
  readonly showFavorites = input<boolean>();
  readonly showMeta = input<boolean>();
  readonly thumbAutoAdvance = input<boolean>();

  containerWidth = 100; // arbitrary rather than undefined
  firstFilePath = '';
  folderThumbPaths: string[] = [];
  fullFilePath = '';
  hover = false;
  inside = false;      // WsQ: mouse over the thumbnail (cover art is hidden while scrubbing)
  coverWide = true;    // WsQ: landscape cover fills the tile, portrait one is centered on a blurred copy
  indexToShow = 1;
  percentOffset = 0;
  scrollInterval: any = null;

  constructor(
    public filePathService: FilePathService,
    public imageElementService: ImageElementService,
  ) { }

  ngOnInit() {
    // multiple hashes == folder view
    if (this.video.hash.indexOf(':') !== -1) {
      const hashes = this.video.hash.split(':');
      hashes.slice(0, 4).forEach((hash) => {
        this.folderThumbPaths.push(this.filePathService.createFilePath(this.folderPath(), this.hubName(), 'thumbnails', hash));
      });
    } else {
      this.firstFilePath = this.filePathService.createFilePath(this.folderPath(), this.hubName(), 'thumbnails', this.video.hash);
      this.fullFilePath = this.filePathService.createFilePath(this.folderPath(), this.hubName(), 'filmstrips', this.video.hash);
      this.folderThumbPaths.push(this.firstFilePath);
    }

    if (this.video.defaultScreen) {
      this.hover = true;
      this.percentOffset = this.defaultScreenOffset(this.video);
    }
  }

  defaultScreenOffset(video: ImageElement): number {
    return 100 * video.defaultScreen / video.screens;
  }

  /** WsQ: path to the cover art (if the file has one) */
  get coverSrc(): string {
    const v = this.video;
    if (!v || !v.cover || v.cover <= 0 || v.cleanName === '*FOLDER*') {
      return '';
    }
    return this.filePathService.createFilePath(this.folderPath(), this.hubName(), 'covers', v.hash) + '?v=' + v.cover;
  }

  /** WsQ: JAV-style code from the file name (e.g. PPPE029 -> PPPE-029), shown on the cover */
  get coverCode(): string {
    const name = this.video?.fileName || '';
    const m = name.match(/(?:^|[^A-Za-z0-9])([A-Za-z]{2,6})-?(\d{2,5})(?![0-9])/);
    return m ? (m[1].toUpperCase() + '-' + m[2]) : '';
  }

  get scrubTicks(): number[] {
    const n = Math.min(Math.max(this.video?.screens || 0, 1), 30);
    return Array.from({ length: n }, (_, i) => i);
  }

  get scrubIndex(): number {
    const n = Math.min(Math.max(this.video?.screens || 0, 1), 30);
    return Math.max(0, Math.min(n - 1, Math.floor(this.percentOffset / 100 * n)));
  }

  onCoverLoad(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (img && img.naturalHeight) {
      const a = img.naturalWidth / img.naturalHeight;
      if (!this.video.coverAspect) {
        this.video.coverAspect = Math.round(a * 1000) / 1000;
      }
      // fill the tile unless the cover is much narrower than the tile (then: centered on a blurred copy)
      const box = (this.elWidth() || 1) / (this.imgHeight() || 1);
      this.coverWide = a >= box * 0.78;
    }
  }

  /** WsQ: frames are 16:9 -- scale them to cover the tile (any shape) and keep the shown frame centered */
  get stripStyle(): Record<string, string> {
    const boxW = this.elWidth() || 1;
    const boxH = this.imgHeight() || 1;
    const fa = 16 / 9;
    const frameH = Math.max(boxH, boxW / fa);
    const frameW = frameH * fa;
    const n = Math.max(1, this.video.screens || 1);
    const idx = this.hover ? Math.round(this.percentOffset / 100 * n) : 0;
    const tx = -idx * frameW + (boxW - frameW) / 2;
    const ty = (boxH - frameH) / 2;
    return { height: frameH + 'px', transform: 'translate(' + tx + 'px, ' + ty + 'px)' };
  }

  /** WsQ: label in the bottom-left corner -- the code (e.g. PPPE-029) or the name */
  get cornerName(): string {
    return this.coverCode || (this.video?.cleanName || '');
  }

  mouseEntered() {
    this.inside = true;
    this.containerWidth = this.filmstripHolder().nativeElement.getBoundingClientRect().width;

    if (this.thumbAutoAdvance()) {
      this.hover = true;

      this.scrollInterval = setInterval(() => {
        this.percentOffset = this.indexToShow * (100 / this.video.screens);
        this.indexToShow++;
      }, 750);

    } else if (this.hoverScrub()) {
      this.hover = true;
    }
  }

  mouseLeft() {
    this.inside = false;
    if (this.thumbAutoAdvance()) {
      clearInterval(this.scrollInterval);
    }

    if (this.returnToFirstScreenshot()) {
      if (this.video.defaultScreen !== undefined) {
        this.percentOffset = this.defaultScreenOffset(this.video);
      } else {
        this.hover = false;
        this.percentOffset = 0;
      }
    }
  }

  mouseIsMoving($event: any) {
    if (this.hoverScrub()) {
      const cursorX = $event.layerX;
      this.indexToShow = Math.floor(cursorX * (this.video.screens / this.containerWidth));
      this.percentOffset = this.indexToShow * (100 / this.video.screens);
    }
  }

  ngOnDestroy() {
    clearInterval(this.scrollInterval);
  }

  openDetailsView(leftClick: PointerEvent): void {
    leftClick.stopPropagation()

    this.sheetClick.emit();
  }

  toggleHeart(leftClick: PointerEvent): void {
    leftClick.stopPropagation();

    this.imageElementService.toggleHeart(this.video.index);
    this.heartPressed.emit();
  }

  togglePlaylist(leftClick: PointerEvent): void {
    leftClick.stopPropagation();

    this.imageElementService.updatePlaylist(this.video.index);
    this.refreshPlaylist.emit();
  }

}
