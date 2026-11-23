import { Component, input, output } from '@angular/core';

import { TagLibraryService } from './tag-library.service';

import type { ImageElement } from '../../../../interfaces/final-object.interface';

/**
 * Shown in the details of a video:
 *   - inherited tags (from tagged folders), dimmed
 *   - "Auto tagging" -- tags whose name / alias appears in the file name
 */
@Component({
  standalone: false,
  selector: 'app-item-tags',
  template: `
@let v = video();
@if (v) {
  @let eff = lib.getEffective(v);
  <div class="it" [ngClass]="{ dark: darkMode() }">

    @if (eff.inherited.length) {
      <div class="row">
        <span class="lbl">{{ 'TAGLIB.inherited' | translate }}:</span>
        @for (t of eff.inherited; track t) {
          <span class="chip inh" (click)="filter.emit({ name: t, event: $event })" title="{{ 'TAGLIB.inheritedHint' | translate }}">
            @if (lib.iconOf(t)) { <span class="ic">{{ lib.iconOf(t) }}</span> }{{ t }}
          </span>
        }
      </div>
    }


  </div>
}
  `,
  styles: [`
:host { display: block; }
.it { --fg: #222; --dim: #777; --chip: #fff; --border: #cfcfcf; --accent: var(--wsq-accent); color: var(--fg); font-size: 12px; margin-top: 6px; }
.it.dark { --fg: #ddd; --dim: #8a8a8a; --chip: #262626; --border: #3a3a3a; --accent: var(--wsq-accent); }
.row { align-items: center; display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0; }
.lbl { color: var(--dim); font-size: 11px; margin-right: 2px; }
.chip {
  align-items: center; background: var(--chip); border: 1px solid var(--border); border-radius: 5px;
  cursor: pointer; display: inline-flex; gap: 4px; height: 22px; padding: 0 7px; white-space: nowrap;
}
.chip:hover { border-color: var(--accent); }
.chip.inh { opacity: .6; }
.chip.inh:hover { opacity: 1; }
.chip.sug { border-style: dashed; }
.chip.all { border-color: var(--accent); color: var(--accent); }
.ic { font-family: 'Segoe UI Variable Text', 'Segoe UI', Inter, 'Twemoji Country Flags', 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif; font-size: 13px; }
.plus { color: var(--accent); font-weight: bold; }
.none { color: var(--dim); font-size: 11px; }
.auto { border: 1px solid var(--border); border-radius: 6px; margin-top: 6px; padding: 4px 8px; }
.auto-head { align-items: center; cursor: pointer; display: flex; font-size: 11px; justify-content: space-between; }
.auto-head svg { fill: none; height: 12px; stroke: var(--fg); stroke-linecap: round; stroke-width: 1.5; transition: transform 150ms; width: 12px; }
.auto-head svg.flip { transform: rotate(180deg); }
  `]
})
export class ItemTagsComponent {

  readonly video = input<ImageElement>();
  readonly darkMode = input<boolean>(false);

  readonly filter = output<{ name: string, event: MouseEvent }>();

  constructor(public lib: TagLibraryService) { }


}
