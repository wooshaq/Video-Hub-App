import { Component, input, output } from '@angular/core';

import { TagLibraryService } from './tag-library.service';

@Component({
  standalone: false,
  selector: 'app-tag-filter-bar',
  template: `
<div class="tfb" [ngClass]="{ dark: darkMode(), expanded: expanded }">
  <div class="tfb-chips">

    <span class="tfb-btn" (click)="clear()" title="{{ 'TAGLIB.clearTagFilter' | translate }}">
      <svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" /></svg>
    </span>

    <span
      class="tfb-btn"
      [ngClass]="{ on: lib.lib.unionMode }"
      (click)="lib.toggleUnionMode(); changed.emit()"
      title="{{ (lib.lib.unionMode ? 'TAGLIB.unionMode' : 'TAGLIB.intersectionMode') | translate }}"
    >
      <svg viewBox="0 0 16 16"><circle cx="6" cy="8" r="4.5" /><circle cx="10" cy="8" r="4.5" /></svg>
    </span>

    @for (t of lib.active; track t) {
      <span class="chip active" (click)="lib.activate(t, 'toggle'); changed.emit()">
        @if (lib.iconOf(t)) { <span class="ic">{{ lib.iconOf(t) }}</span> }
        {{ t }}
        <span class="x">✕</span>
      </span>
    }

    @for (t of lib.excluded; track t) {
      <span class="chip excluded" (click)="lib.deactivate(t); changed.emit()" title="{{ 'TAGLIB.excludedHint' | translate }}">
        @if (lib.iconOf(t)) { <span class="ic">{{ lib.iconOf(t) }}</span> }
        {{ t }}
        <span class="x">✕</span>
      </span>
    }

    @if (lib.related.length) {
      <span class="tfb-sep"></span>
    }

    @for (r of lib.related; track r.name) {
      <span
        class="chip related"
        (click)="relatedClick($event, r.name)"
        title="{{ 'TAGLIB.relatedHint' | translate }}"
      >
        @if (r.icon) { <span class="ic">{{ r.icon }}</span> }
        {{ r.name }}
        <span class="cnt">{{ r.count }}</span>
      </span>
    }
  </div>

  <span class="tfb-more" (click)="expanded = !expanded" [title]="(expanded ? 'TAGLIB.less' : 'TAGLIB.more') | translate">
    <svg viewBox="0 0 16 16" [ngClass]="{ flip: expanded }"><path d="M4 6l4 4 4-4" /></svg>
  </span>
</div>
  `,
  styles: [`
:host { display: block; }

.tfb {
  --bg: #ececec; --fg: #222; --dim: #777; --chip: #fff; --border: #cfcfcf; --accent: #3b8eea;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  box-sizing: border-box;
  display: flex;
  height: 40px;
  overflow: hidden;
  padding: 6px 6px 6px 10px;
  position: relative;
}
.tfb.dark { --bg: #161616; --fg: #e0e0e0; --dim: #8a8a8a; --chip: #262626; --border: #000; --accent: #4cb4ff; }
.tfb.expanded {
  box-shadow: 0 10px 24px rgba(0,0,0,.4);
  height: auto;
  max-height: 60vh;
  overflow-y: auto;
  z-index: 20;
}
.tfb-chips {
  align-content: flex-start;
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  gap: 5px;
  overflow: hidden;
}
.tfb:not(.expanded) .tfb-chips {
  -webkit-mask-image: linear-gradient(to right, #000 85%, transparent 100%);
}
.chip {
  align-items: center;
  background: var(--chip);
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--fg);
  cursor: pointer;
  display: inline-flex;
  font-size: 12px;
  gap: 5px;
  height: 26px;
  padding: 0 9px;
  white-space: nowrap;
}
.chip:hover { border-color: var(--accent); }
.chip .ic { font-family: 'Twemoji Country Flags', 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif; font-size: 14px; }
.chip .x { color: var(--dim); font-size: 10px; margin-left: 2px; }
.chip .cnt { color: var(--dim); font-size: 10px; }
.chip.active { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); font-weight: 600; }
.chip.excluded { border-color: #ff6b6b; color: #ff6b6b; text-decoration: line-through; }
.chip.related { opacity: .55; }
.chip.related:hover { opacity: 1; }
.tfb-btn {
  align-items: center; border-radius: 5px; cursor: pointer; display: inline-flex;
  height: 26px; justify-content: center; width: 26px;
}
.tfb-btn:hover { background: rgba(127,127,127,.18); }
.tfb-btn.on svg { stroke: var(--accent); }
.tfb-btn svg, .tfb-more svg {
  fill: none; height: 14px; stroke: var(--fg); stroke-linecap: round; stroke-width: 1.5; width: 14px;
}
.tfb-sep { border-left: 1px solid var(--border); height: 26px; margin: 0 4px; }
.tfb-more {
  align-items: center; border-radius: 5px; cursor: pointer; display: flex; flex: 0 0 auto;
  height: 26px; justify-content: center; width: 26px;
}
.tfb-more:hover { background: rgba(127,127,127,.18); }
.tfb-more svg { transition: transform 150ms; }
.tfb-more svg.flip { transform: rotate(180deg); }
  `]
})
export class TagFilterBarComponent {

  readonly darkMode = input<boolean>(false);
  readonly changed = output<void>();

  expanded = false;

  constructor(public lib: TagLibraryService) { }

  relatedClick(event: MouseEvent, name: string): void {
    this.lib.activate(name, event.shiftKey ? 'exclude' : 'toggle');
    this.changed.emit();
  }

  clear(): void {
    this.lib.clearFilter();
    this.expanded = false;
    this.changed.emit();
  }

}
