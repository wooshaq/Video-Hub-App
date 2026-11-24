import { Component, input } from '@angular/core';

import { TagLibraryService } from './tag-library.service';

import type { ImageElement } from '../../../../interfaces/final-object.interface';

/**
 * Small row of tag badges (tags with the "Badge" attribute) shown on gallery items
 */
@Component({
  standalone: false,
  selector: 'app-tag-badges',
  template: `
@let badges = lib.badgesFor(video());
@if (badges.length) {
  <div class="badges" [ngClass]="{ dark: darkMode() }">
    @for (b of badges; track b.name) {
      <span class="b" [title]="b.name" [ngClass]="{ 'b-icon': b.mode === 'icon' }">
        @if (b.mode !== 'name' && b.icon) { <span class="ic">{{ b.icon }}</span> }
        @if (b.mode !== 'icon') { <span class="nm">{{ b.name }}</span> }
      </span>
    }
  </div>
}
  `,
  styles: [`
:host { display: block; pointer-events: none; }
.badges { display: flex; flex-wrap: nowrap; gap: 3px; overflow: hidden; }
.b {
  align-items: center;
  background: rgba(240,240,240,.92);
  border-radius: 4px;
  color: #222;
  display: inline-flex;
  flex: 0 0 auto;
  font-size: 10px;
  gap: 3px;
  height: 18px;
  padding: 0 5px;
  pointer-events: auto;
}
.badges.dark .b { background: var(--g-s3, #262626); color: var(--g-tx2, #ddd); border-radius: 999px; padding: 0 7px; }
.b-icon { padding: 0 3px; }
.badges.dark .b-icon { background: transparent; padding: 0 1px; }
.badges { justify-content: flex-end; }
.ic { font-family: 'Segoe UI Variable Text', 'Segoe UI', Inter, 'Twemoji Country Flags', 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif; font-size: 12px; line-height: 1; }
.nm { white-space: nowrap; }
  `]
})
export class TagBadgesComponent {

  readonly video = input<ImageElement>();
  readonly darkMode = input<boolean>(false);

  constructor(public lib: TagLibraryService) { }

}
