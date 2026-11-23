import { Component, ElementRef, HostListener, NgZone, input, output, viewChild } from '@angular/core';
import type { AfterViewChecked, OnDestroy } from '@angular/core';

import { TagLibraryService } from './tag-library.service';

/**
 * Active tags (ZAWIERA / UNIKA) + related tags, flowing line by line, at most 3 lines.
 * The "wszystkie" button sits at the end of the 3rd line and opens a popup with every related tag.
 */
@Component({
  standalone: false,
  selector: 'app-tag-filter-bar',
  template: `
<div class="tfb" [ngClass]="{ dark: darkMode() }">
  <div class="tfb-chips" #chips>

    <button class="tfb-btn" (click)="clear()" title="{{ 'TAGLIB.clearTagFilter' | translate }}" aria-label="Wyczyść filtr">
      <svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" /></svg>
    </button>

    <button
      class="tfb-btn"
      [ngClass]="{ on: lib.lib.unionMode }"
      (click)="lib.toggleUnionMode(); changed.emit()"
      title="{{ (lib.lib.unionMode ? 'TAGLIB.unionMode' : 'TAGLIB.intersectionMode') | translate }}"
      aria-label="Część wspólna / suma"
    >
      <svg viewBox="0 0 16 16"><circle cx="6" cy="8" r="4.5" /><circle cx="10" cy="8" r="4.5" /></svg>
    </button>

    @for (t of lib.active; track t) {
      <span class="chip active">
        <button class="mode inc" (click)="lib.toggleMode(t); changed.emit()" title="{{ 'TAGLIB.modeToggleHint' | translate }}">{{ 'TAGLIB.modeInclude' | translate }}</button>
        @if (lib.iconOf(t)) { <span class="ic">{{ lib.iconOf(t) }}</span> }
        <span class="nm">{{ t }}</span>
        <button class="x" (click)="lib.deactivate(t); changed.emit()" aria-label="Usuń">✕</button>
      </span>
    }

    @for (t of lib.excluded; track t) {
      <span class="chip excluded">
        <button class="mode exc" (click)="lib.toggleMode(t); changed.emit()" title="{{ 'TAGLIB.modeToggleHint' | translate }}">{{ 'TAGLIB.modeExclude' | translate }}</button>
        @if (lib.iconOf(t)) { <span class="ic">{{ lib.iconOf(t) }}</span> }
        <span class="nm">{{ t }}</span>
        <button class="x" (click)="lib.deactivate(t); changed.emit()" aria-label="Usuń">✕</button>
      </span>
    }

    @for (r of lib.related; track r.name) {
      <button class="chip related" data-related="1" (click)="relatedClick($event, r.name)" (auxclick)="relatedAux($event, r.name)" title="{{ 'TAGLIB.relatedHint' | translate }}">
        @if (r.icon) { <span class="ic">{{ r.icon }}</span> }
        {{ r.name }}
        <span class="cnt">{{ r.count }}</span>
      </button>
    }

    <button #allBtn class="chip all" (click)="popupOpen = !popupOpen; popupFilter = ''" [ngClass]="{ on: popupOpen }">
      {{ 'TAGLIB.allRelated' | translate }} ({{ lib.related.length }})
      <svg viewBox="0 0 16 16" [ngClass]="{ flip: popupOpen }"><path d="M4 6l4 4 4-4" /></svg>
    </button>
  </div>

  @if (popupOpen) {
    <div class="tfb-popup">
      <div class="pp-head">
        <input
          type="text"
          [(ngModel)]="popupFilter"
          placeholder="{{ 'TAGLIB.filterRelated' | translate }}"
          (keyup.escape)="popupOpen = false"
        >
        <span class="pp-hint">{{ 'TAGLIB.relatedPopupHint' | translate }}</span>
        <button class="tfb-btn" (click)="popupOpen = false" aria-label="Zamknij">
          <svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </div>
      <div class="pp-list">
        @for (r of filteredRelated(); track r.name) {
          <button class="chip" (click)="relatedClick($event, r.name)" (auxclick)="relatedAux($event, r.name)">
            @if (r.icon) { <span class="ic">{{ r.icon }}</span> }
            {{ r.name }}
            <span class="cnt">{{ r.count }}</span>
          </button>
        } @empty {
          <span class="pp-empty">{{ 'TAGLIB.noMatch' | translate }}</span>
        }
      </div>
    </div>
  }
</div>
  `,
  styles: [`
:host { display: block; }

.tfb {
  --bg: #ececec; --fg: #222; --dim: #777; --chip: #fff; --border: #cfcfcf; --accent: #3b8eea; --red: #d9534f;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  box-sizing: border-box;
  padding: 7px 10px 7px 10px;
  position: relative;
}
.tfb.dark { --bg: #181818; --fg: #e0e0e0; --dim: #8a8a8a; --chip: #232323; --border: #2e2e2e; --accent: #4cb4ff; --red: #e06a6a; }

.tfb-chips {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  overflow: hidden;
}

button { font: inherit; }

.chip {
  align-items: center;
  background: var(--chip);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-sizing: border-box;
  color: var(--fg);
  cursor: pointer;
  display: inline-flex;
  flex: 0 0 auto;
  font-size: 12px;
  gap: 6px;
  height: 28px;
  padding: 0 9px;
  white-space: nowrap;
}
.chip:hover { border-color: var(--accent); }
.ic { font-family: 'Twemoji Country Flags', 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif; font-size: 14px; }
.cnt { color: var(--dim); font-size: 10px; }

.chip.related { color: var(--dim); }
.chip.related .ic { opacity: .65; }
.chip.related:hover { color: var(--fg); }
.chip.related:hover .ic { opacity: 1; }

.chip.active, .chip.excluded { cursor: default; font-weight: 600; padding: 0 6px 0 3px; }
.chip.active { border-color: var(--accent); }
.chip.excluded { border-color: var(--red); }
.chip.excluded .nm { color: var(--red); text-decoration: line-through; }

.mode {
  border: 0;
  border-radius: 4px;
  cursor: pointer;
  font-size: 9.5px !important;
  font-weight: 700;
  height: 20px;
  letter-spacing: .4px;
  padding: 0 6px;
  text-transform: uppercase;
}
.mode.inc { background: var(--accent); color: #0d2233; }
.mode.exc { background: var(--red); color: #2a0f10; }

.x { background: transparent; border: 0; color: var(--dim); cursor: pointer; font-size: 10px; padding: 0 2px; }
.x:hover { color: var(--fg); }

.chip.all { border-style: dashed; color: var(--fg); }
.chip.all.on { border-color: var(--accent); border-style: solid; }
.chip.all svg, .tfb-btn svg {
  fill: none; height: 13px; stroke: var(--fg); stroke-linecap: round; stroke-width: 1.5; width: 13px;
}
.chip.all svg { transition: transform 150ms; }
.chip.all svg.flip { transform: rotate(180deg); }

.tfb-btn {
  align-items: center; background: transparent; border: 0; border-radius: 6px; cursor: pointer;
  display: inline-flex; flex: 0 0 auto; height: 28px; justify-content: center; padding: 0; width: 28px;
}
.tfb-btn:hover { background: rgba(127,127,127,.18); }
.tfb-btn.on svg { stroke: var(--accent); }

.tfb-popup {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 14px 40px rgba(0,0,0,.5);
  display: flex;
  flex-direction: column;
  left: 10px;
  max-height: 60vh;
  position: absolute;
  right: 10px;
  top: calc(100% + 4px);
  z-index: 30;
}
.pp-head { align-items: center; border-bottom: 1px solid var(--border); display: flex; gap: 10px; padding: 8px 10px; }
.pp-head input {
  background: var(--chip); border: 1px solid var(--border); border-radius: 6px; color: var(--fg);
  flex: 1; font: inherit; font-size: 12px; height: 28px; padding: 0 10px; outline: none;
}
.pp-head input:focus { border-color: var(--accent); }
.pp-hint { color: var(--dim); font-size: 11px; white-space: nowrap; }
.pp-list { align-content: flex-start; display: flex; flex-wrap: wrap; gap: 6px; overflow-y: auto; padding: 10px; }
.pp-empty { color: var(--dim); font-size: 12px; }
  `]
})
export class TagFilterBarComponent implements AfterViewChecked, OnDestroy {

  readonly darkMode = input<boolean>(false);
  readonly changed = output<void>();
  readonly heightChange = output<number>();

  readonly chips = viewChild<ElementRef<HTMLElement>>('chips');
  readonly allBtn = viewChild<ElementRef<HTMLElement>>('allBtn');

  popupOpen = false;
  popupFilter = '';

  private lastSig = '';
  private lastHeight = -1;
  private resizeObserver: ResizeObserver;

  constructor(
    public lib: TagLibraryService,
    private host: ElementRef<HTMLElement>,
    private zone: NgZone,
  ) {
    this.zone.runOutsideAngular(() => {
      this.resizeObserver = new ResizeObserver(() => {
        this.lastSig = '';
        this.layout();
      });
      this.resizeObserver.observe(this.host.nativeElement);
    });
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.heightChange.emit(0);
  }

  filteredRelated() {
    const f = (this.popupFilter || '').trim().toLowerCase();
    return f ? this.lib.related.filter(r => r.name.toLowerCase().includes(f)) : this.lib.related;
  }

  relatedClick(event: MouseEvent, name: string): void {
    this.lib.activate(name, event.shiftKey ? 'exclude' : 'toggle');
    this.changed.emit();
  }

  /** middle click = exclude (as in Ritt) */
  relatedAux(event: MouseEvent, name: string): void {
    if (event.button === 1) {
      event.preventDefault();
      this.lib.activate(name, 'exclude');
      this.changed.emit();
    }
  }

  clear(): void {
    this.lib.clearFilter();
    this.popupOpen = false;
    this.changed.emit();
  }

  @HostListener('document:mousedown', ['$event'])
  docDown(event: MouseEvent): void {
    if (this.popupOpen && !this.host.nativeElement.contains(event.target as Node)) {
      this.popupOpen = false;
    }
  }

  ngAfterViewChecked(): void {
    const sig = this.lib.active.join('\u0001') + '|' + this.lib.excluded.join('\u0001') + '|' + this.lib.related.map(r => r.name + r.count).join('\u0001');
    if (sig !== this.lastSig) {
      this.lastSig = sig;
      this.layout();
    }
  }

  /**
   * Show as many related chips as fit in 3 lines with the "all" button at the end of the 3rd line.
   * Works on the DOM directly (display: none), so no extra change detection round.
   */
  private layout(): void {
    const box = this.chips()?.nativeElement;
    const btn = this.allBtn()?.nativeElement;
    if (!box || !btn) {
      return;
    }
    const related = Array.from(box.querySelectorAll('[data-related]')) as HTMLElement[];
    related.forEach(el => el.style.display = '');
    btn.style.display = '';

    const first = box.firstElementChild as HTMLElement;
    const top0 = first ? first.offsetTop : 0;
    const rowStep = 34; // 28 px chip + 6 px gap
    const rowOf = (el: HTMLElement) => Math.round((el.offsetTop - top0) / rowStep);

    const lastRelated = related[related.length - 1];
    const everythingFits = !lastRelated || rowOf(lastRelated) <= 2;
    if (everythingFits) {
      btn.style.display = 'none';     // nothing hidden -- no need for the button
    } else {
      // binary search: the most related chips so that the button still ends up on line 3
      let lo = 0;
      let hi = related.length;
      const fits = (k: number) => {
        related.forEach((el, i) => el.style.display = i < k ? '' : 'none');
        return rowOf(btn) <= 2;
      };
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (fits(mid)) { lo = mid; } else { hi = mid - 1; }
      }
      fits(lo);
    }

    const h = this.host.nativeElement.offsetHeight;
    if (h !== this.lastHeight) {
      this.lastHeight = h;
      this.zone.run(() => setTimeout(() => this.heightChange.emit(h)));
    }
  }

}
