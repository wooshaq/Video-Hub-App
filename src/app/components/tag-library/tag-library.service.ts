import { javKey } from './jav-code';
import { Injectable, NgZone } from '@angular/core';
import { Subject } from 'rxjs';

import { ImageElementService } from '../../services/image-element.service';
import { ManualTagsService } from '../tags-manual/manual-tags.service';

import type { ImageElement } from '../../../../interfaces/final-object.interface';
import type { TagBadgeMode, TagLibrary, TagNode } from '../../../../interfaces/tag-library.interface';
import { NewTagLibrary } from '../../../../interfaces/tag-library.interface';
import type { RittImportData, RittTag } from '../../../../interfaces/ritt.interface';

export interface EffectiveTags {
  direct: string[];       // tags stored on the file itself
  inherited: string[];    // tags coming from folders (not already direct)
  all: Set<string>;
}

export interface FlatRow {
  node: TagNode;
  depth: number;
  parent: TagNode | null;
  hasChildren: boolean;
}

export interface TagChip {
  name: string;
  icon?: string;
  count?: number;
}

interface CacheEntry {
  v: number;
  sig: string;
  eff: EffectiveTags;
}

export const HOTKEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

export interface ViewTabState {
  active: string[];
  excluded: string[];
  search: string;
  folder: { source: number, path: string } | null;
}

@Injectable()
export class TagLibraryService {

  lib: TagLibrary = NewTagLibrary();
  loaded = false;

  /** per-hub: folder partialPath (e.g. `/Actresses/Alice Otsu`) -> tag names */
  folderTags: Record<string, string[]> = {};

  /** active filter */
  active: string[] = [];
  excluded: string[] = [];

  /** tags common with the current results (filled by the filter pipe) */
  related: TagChip[] = [];

  /** bumped whenever library structure / attributes change */
  libVersion = 0;
  /** bumped whenever tag assignments change */
  dataVersion = 0;
  /** bumped whenever the filter must re-run */
  filterVersion = 0;

  /** emits whenever the gallery should refresh (details views etc.) */
  changed = new Subject<void>();

  private byName = new Map<string, TagNode>();
  private parentOf = new Map<TagNode, TagNode | null>();
  private expandCache = new Map<string, Set<string>>();
  private effCache = new WeakMap<ImageElement, CacheEntry>();
  private countsCache: { key: string, counts: Map<string, number> } = { key: '', counts: new Map() };
  private saveTimer: any;
  private hubSyncPending = false;

  constructor(
    private imageElementService: ImageElementService,
    private manualTagsService: ManualTagsService,
    private zone: NgZone,
  ) {
    this.reindex();
    this.manualTagsService.onTagAdded = (name: string, isNew: boolean) => {
      if (isNew) {
        this.ensureTag(name);
      }
      this.quickBump();
    };
    this.manualTagsService.onTagsChanged = () => this.quickBump();
  }

  /** cheap invalidation (no events) -- used by hooks that may fire thousands of times */
  private quickBump(): void {
    this.dataVersion++;
    this.filterVersion++;
    this.countsCache.key = '';
  }

  private touchLibQueued = false;

  private queueTouchLib(): void {
    if (!this.touchLibQueued) {
      this.touchLibQueued = true;
      Promise.resolve().then(() => {
        this.touchLibQueued = false;
        this.touchLib();
      });
    }
  }

  // ===========================================================================================
  // Loading & saving
  // ===========================================================================================

  init(): void {
    (window as any).myElectron.receiveFromMain('tag-library-loaded', (data: TagLibrary | null) => {
      this.zone.run(() => {
        if (data && Array.isArray(data.roots)) {
          this.lib = data;
          this.lib.recentIcons = this.lib.recentIcons || [];
        }
        this.loaded = true;
        this.reindex();
        if (this.hubSyncPending) {
          this.syncWithHub();
        }
        this.touchLib(false);
      });
    });
    (window as any).myElectron.sendToMain('load-tag-library');

    (window as any).myElectron.receiveFromMain('ritt-import-data', (data: RittImportData) => {
      this.zone.run(() => this.rittImportReceived.next(data));
    });
  }

  /** emits the parsed Ritt database after the user picked a file */
  rittImportReceived = new Subject<RittImportData>();

  pickRittFile(): void {
    (window as any).myElectron.sendToMain('ritt-import-pick');
  }

  private scheduleSave(): void {
    if (!this.loaded) {
      return; // never overwrite the file before it was read
    }
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 400);
  }

  saveNow(): void {
    if (!this.loaded) {
      return;
    }
    clearTimeout(this.saveTimer);
    (window as any).myElectron.sendToMain('save-tag-library', JSON.parse(JSON.stringify(this.lib)));
  }

  /** call after a hub (.vha2) is opened */
  onHubLoaded(folderTags: Record<string, string[]> | undefined): void {
    this.folderTags = folderTags ? JSON.parse(JSON.stringify(folderTags)) : {};
    this.active = [];
    this.excluded = [];
    this.related = [];
    this.effCache = new WeakMap();
    if (this.loaded) {
      this.syncWithHub();
    } else {
      this.hubSyncPending = true;
    }
    this.touchData();
  }

  getFolderTagsForSaving(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    Object.keys(this.folderTags).forEach(k => {
      if (this.folderTags[k] && this.folderTags[k].length) {
        out[k] = this.folderTags[k];
      }
    });
    return out;
  }

  /** every tag used in the hub must exist in the library (new ones go to the bottom of the tree) */
  private syncWithHub(): void {
    this.hubSyncPending = false;
    let added = false;
    const names = new Set<string>(this.manualTagsService.tagsList);
    Object.values(this.folderTags).forEach(arr => arr.forEach(t => names.add(t)));
    names.forEach(name => {
      if (!this.byName.has(name)) {
        this.lib.roots.push(this.newNode(name));
        added = true;
      }
    });
    if (added) {
      this.touchLib();
    }
  }

  // ===========================================================================================
  // Index helpers
  // ===========================================================================================

  private reindex(): void {
    this.byName.clear();
    this.parentOf.clear();
    this.expandCache.clear();
    const walk = (nodes: TagNode[], parent: TagNode | null) => {
      nodes.forEach(n => {
        this.parentOf.set(n, parent);
        if (n.type !== 'separator' && !this.byName.has(n.name)) {
          this.byName.set(n.name, n);
        }
        if (n.children) {
          walk(n.children, n);
        }
      });
    };
    walk(this.lib.roots, null);
  }

  /** library structure / attributes changed */
  touchLib(save = true): void {
    this.reindex();
    this.libVersion++;
    this.filterVersion++;
    this.countsCache.key = '';
    if (save) {
      this.scheduleSave();
    }
    this.changed.next();
  }

  /** assignments changed */
  touchData(): void {
    this.dataVersion++;
    this.filterVersion++;
    this.countsCache.key = '';
    this.changed.next();
  }

  newNode(name: string): TagNode {
    return { id: this.uuid(), type: 'tag', name };
  }

  newSeparator(): TagNode {
    return { id: this.uuid(), type: 'separator', name: '' };
  }

  private uuid(): string {
    try {
      return (crypto as any).randomUUID();
    } catch {
      return Date.now().toString(36) + Math.random().toString(36).slice(2);
    }
  }

  getNode(name: string): TagNode | undefined {
    return this.byName.get(name);
  }

  getParent(node: TagNode): TagNode | null {
    return this.parentOf.get(node) ?? null;
  }

  siblingsOf(node: TagNode): TagNode[] {
    const p = this.getParent(node);
    return p ? (p.children = p.children || []) : this.lib.roots;
  }

  iconOf(name: string): string {
    return this.byName.get(name)?.icon || '';
  }

  isHidden(name: string): boolean {
    return !!this.byName.get(name)?.hidden;
  }

  nameExists(name: string): boolean {
    return this.byName.has(name);
  }

  isAncestor(maybeAncestor: TagNode, node: TagNode): boolean {
    let p = this.getParent(node);
    while (p) {
      if (p === maybeAncestor) {
        return true;
      }
      p = this.getParent(p);
    }
    return false;
  }

  /** visible rows of the tree (respecting collapse, hidden, text filter) */
  flatten(filterText: string): FlatRow[] {
    const rows: FlatRow[] = [];
    const ft = (filterText || '').trim().toLowerCase();
    const showHidden = !!this.lib.showHidden;

    if (ft) {
      // filter mode -- show matching tags with their ancestors, everything expanded
      const matches = (n: TagNode): boolean => n.type !== 'separator' && (
           n.name.toLowerCase().includes(ft)
        || (n.aliases || []).some(a => a.toLowerCase().includes(ft))
        || (n.notes || '').toLowerCase().includes(ft)
      );
      const walk = (nodes: TagNode[], depth: number, parent: TagNode | null): boolean => {
        let any = false;
        nodes.forEach(n => {
          if (n.hidden && !showHidden) {
            return;
          }
          const before = rows.length;
          const self = matches(n);
          rows.push({ node: n, depth, parent, hasChildren: !!(n.children && n.children.length) });
          const childHit = n.children ? walk(n.children, depth + 1, n) : false;
          if (!self && !childHit) {
            rows.splice(before); // remove this row (and nothing else was added)
          } else {
            any = true;
          }
        });
        return any;
      };
      walk(this.lib.roots, 0, null);
      return rows;
    }

    const walk = (nodes: TagNode[], depth: number, parent: TagNode | null) => {
      nodes.forEach(n => {
        if (n.hidden && !showHidden) {
          return;
        }
        const hasChildren = !!(n.children && n.children.length);
        rows.push({ node: n, depth, parent, hasChildren });
        if (hasChildren && !n.collapsed) {
          walk(n.children, depth + 1, n);
        }
      });
    };
    walk(this.lib.roots, 0, null);
    return rows;
  }

  // ===========================================================================================
  // Effective tags (direct + inherited from folders)
  // ===========================================================================================

  folderAncestors(partialPath: string): string[] {
    const out: string[] = [];
    if (!partialPath) {
      return out;
    }
    const parts = partialPath.split('/').filter(p => p !== '');
    let acc = '';
    parts.forEach(p => {
      acc += '/' + p;
      out.push(acc);
    });
    return out;
  }

  getEffective(item: ImageElement): EffectiveTags {
    const sig = (item.tags || []).join('\u0001') + '\u0002' + item.partialPath;
    const cached = this.effCache.get(item);
    if (cached && cached.v === this.dataVersion * 100000 + this.libVersion && cached.sig === sig) {
      return cached.eff;
    }
    const direct = (item.tags || []).slice();
    const all = new Set<string>(direct);
    const inherited: string[] = [];
    if (item.cleanName === '*FOLDER*') {
      // folder pseudo-item: its own tags are "direct", parents' are inherited
      const own = this.folderTags[item.partialPath] || [];
      own.forEach(t => { if (!all.has(t)) { all.add(t); direct.push(t); } });
      const anc = this.folderAncestors(item.partialPath).slice(0, -1);
      anc.forEach((f, idx) => {
        const level = anc.length - idx;   // subfolder of a tagged folder: level 1
        (this.folderTags[f] || []).forEach(t => {
          const depth = this.byName.get(t)?.inherit;
          if (all.has(t) || (depth !== undefined && level > depth)) {
            return;
          }
          all.add(t);
          inherited.push(t);
        });
      });
    } else {
      // a file directly inside a tagged folder is level 1, one folder deeper level 2, ...
      const anc = this.folderAncestors(item.partialPath);
      anc.forEach((f, idx) => {
        const level = anc.length - idx;
        (this.folderTags[f] || []).forEach(t => {
          if (all.has(t)) {
            return;
          }
          const depth = this.byName.get(t)?.inherit;
          if (depth !== undefined && level > depth) {
            return;
          }
          all.add(t);
          inherited.push(t);
        });
      });
    }
    const eff: EffectiveTags = { direct, inherited, all };
    this.effCache.set(item, { v: this.dataVersion * 100000 + this.libVersion, sig, eff });
    return eff;
  }

  /** names that count as a match when `name` is active (encapsulate => + all descendants) */
  expand(name: string): Set<string> {
    const key = name;
    if (this.expandCache.has(key)) {
      return this.expandCache.get(key);
    }
    const set = new Set<string>([name]);
    const node = this.byName.get(name);
    if (node && node.encapsulate) {
      const walk = (nodes: TagNode[]) => nodes.forEach(n => {
        if (n.type !== 'separator') {
          set.add(n.name);
        }
        if (n.children) {
          walk(n.children);
        }
      });
      walk(node.children || []);
    }
    this.expandCache.set(key, set);
    return set;
  }

  matches(item: ImageElement, name: string): boolean {
    const all = this.getEffective(item).all;
    const exp = this.expand(name);
    if (exp.size === 1) {
      return all.has(name);
    }
    for (const n of exp) {
      if (all.has(n)) {
        return true;
      }
    }
    return false;
  }

  // ---------- WsQ: custom folder icons (desktop.ini), key = folder partialPath ----------

  folderIcons = new Map<string, string>();

  /** WsQ: thumbnails made while the app runs -> hash: time (used to refresh the picture on screen) */
  thumbReady = new Map<string, number>();
  thumbReadyVersion = 0;

  /** WsQ: delay (ms) before hovering a thumbnail starts the preview -- Settings -> Look */
  hoverDelay = 0;

  // WsQ: own zoom of the tag / folder tree (Ctrl + mouse wheel over it)
  paneZoom = (() => {
    try {
      return Math.max(0.7, Math.min(1.6, parseFloat(localStorage.getItem('wsq.tagZoom') || '1') || 1));
    } catch {
      return 1;
    }
  })();

  paneWheel(event: WheelEvent): void {
    if (!event.ctrlKey) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.paneZoom = Math.max(0.7, Math.min(1.6, Math.round((this.paneZoom + (event.deltaY < 0 ? 0.1 : -0.1)) * 10) / 10));
    try {
      localStorage.setItem('wsq.tagZoom', String(this.paneZoom));
    } catch { }
  }
  folderIconVersion = 0;

  // ---------- WsQ: duplicates (more files with the same JAV code) ----------

  dupMode = false;
  private dupCache: { key: string, keys: Set<string>, files: number, codes: number } = { key: '', keys: new Set(), files: 0, codes: 0 };

  dupStats(): { keys: Set<string>, files: number, codes: number } {
    const items = this.imageElementService.imageElements;
    const key = items.length + ':' + this.dataVersion;
    if (this.dupCache.key !== key) {
      const count = new Map<string, number>();
      items.forEach(e => {
        if (e && !e.deleted && e.cleanName !== '*FOLDER*') {
          const k = javKey(e.fileName);
          if (k) {
            count.set(k, (count.get(k) || 0) + 1);
          }
        }
      });
      const keys = new Set<string>();
      let files = 0;
      count.forEach((n, k) => {
        if (n > 1) {
          keys.add(k);
          files += n;
        }
      });
      this.dupCache = { key, keys, files, codes: keys.size };
    }
    return this.dupCache;
  }

  toggleDupMode(): void {
    this.dupMode = !this.dupMode;
    this.filterVersion++;
  }

  // ---------- WsQ: view tabs ----------

  tabs: ViewTabState[] = [{ active: [], excluded: [], search: '', folder: null }];
  tabIndex = 0;
  tabProvider: { get: () => ViewTabState, set: (s: ViewTabState) => void } | null = null;

  private saveCurrentTab(): void {
    if (this.tabProvider) {
      this.tabs[this.tabIndex] = this.tabProvider.get();
    }
  }

  switchTab(i: number): void {
    if (i === this.tabIndex || i < 0 || i >= this.tabs.length) {
      return;
    }
    this.saveCurrentTab();
    this.tabIndex = i;
    this.tabProvider?.set(this.tabs[i]);
  }

  newTab(state?: ViewTabState): void {
    this.saveCurrentTab();
    const s = state || this.tabs[this.tabIndex];
    this.tabs.push({ active: s.active.slice(), excluded: s.excluded.slice(), search: s.search, folder: s.folder ? { ...s.folder } : null });
    this.tabIndex = this.tabs.length - 1;
    this.tabProvider?.set(this.tabs[this.tabIndex]);
  }

  closeTab(i: number): void {
    if (this.tabs.length < 2) {
      return;
    }
    this.saveCurrentTab();
    this.tabs.splice(i, 1);
    if (i < this.tabIndex || this.tabIndex >= this.tabs.length) {
      this.tabIndex = Math.max(0, this.tabIndex - 1);
    }
    if (i <= this.tabIndex || i === this.tabIndex + 1) {
      this.tabProvider?.set(this.tabs[this.tabIndex]);
    }
  }

  /** label of a tab -- the live state for the current one */
  tabLabel(i: number): string {
    const s = (i === this.tabIndex && this.tabProvider) ? this.tabProvider.get() : this.tabs[i];
    const parts: string[] = [];
    s.active.forEach(t => parts.push(((this.iconOf(t) || '') + ' ' + t).trim()));
    s.excluded.forEach(t => parts.push('−' + t));
    if (s.folder) {
      const p = s.folder.path === '/' ? '/' : s.folder.path.substring(s.folder.path.lastIndexOf('/') + 1);
      parts.unshift('📁 ' + p);
    }
    if (s.search) {
      parts.push('"' + s.search + '"');
    }
    return parts.join(' · ');
  }

  // ---------- WsQ: folder filter (left pane "Foldery") ----------

  folderFilter: { source: number, path: string } | null = null;

  static normPath(p: string): string {
    return (p || '').replace(/\\/g, '/').replace(/\/+$/, '').replace(/^(?!\/)/, '/');
  }

  setFolderFilter(f: { source: number, path: string } | null): void {
    this.folderFilter = f ? { source: f.source, path: TagLibraryService.normPath(f.path) } : null;
    this.filterVersion++;
  }

  inFolder(item: ImageElement): boolean {
    const f = this.folderFilter;
    if (!f) {
      return true;
    }
    if (+item.inputSource !== +f.source) {
      return false;
    }
    if (f.path === '/') {
      return true;
    }
    const p = TagLibraryService.normPath(item.partialPath);
    return p === f.path || p.startsWith(f.path + '/');
  }

  /** filter used by the gallery pipe */
  filter(items: ImageElement[]): ImageElement[] {
    if (this.dupMode) {
      const keys = this.dupStats().keys;
      items = items.filter(i => i.cleanName !== '*FOLDER*' && keys.has(javKey(i.fileName)));
    }
    if (this.folderFilter) {
      items = items.filter(i => i.cleanName === '*FOLDER*' || this.inFolder(i));
    }
    if (!this.active.length && !this.excluded.length) {
      return items;
    }
    const union = !!this.lib.unionMode;
    return items.filter(item => {
      if (this.excluded.some(t => this.matches(item, t))) {
        return false;
      }
      if (!this.active.length) {
        return true;
      }
      return union
        ? this.active.some(t => this.matches(item, t))
        : this.active.every(t => this.matches(item, t));
    });
  }

  /** compute related tags from the current results */
  /** WsQ: tags of everything in the current view (also with no filter at all) */
  computeRelated(results: ImageElement[]): void {
    const counts = new Map<string, number>();
    results.forEach(item => {
      this.getEffective(item).all.forEach(t => counts.set(t, (counts.get(t) || 0) + 1));
    });
    const skip = new Set<string>([...this.active, ...this.excluded]);
    const out: TagChip[] = [];
    counts.forEach((count, name) => {
      if (!skip.has(name) && !this.isHidden(name)) {
        out.push({ name, count, icon: this.iconOf(name) });
      }
    });
    out.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    Promise.resolve().then(() => this.related = out);
  }

  /** number of files per tag in the whole hub (encapsulated tags count their children too) */
  // ---------- WsQ: counts inside the current view (what you get when you add the tag) ----------

  viewItems: ImageElement[] = [];
  viewFiltered = false;
  private viewVersion = 0;
  private viewCache: { key: string, counts: Map<string, number> } = { key: '', counts: new Map() };

  setViewItems(items: ImageElement[]): void {
    const files = items.filter(i => i && i.cleanName !== '*FOLDER*');
    const live = this.imageElementService.imageElements.filter(i => !i.deleted).length;
    this.viewItems = files;
    this.viewFiltered = files.length < live;
    this.viewVersion++;
    this.computeRelated(files);
  }

  getViewCount(name: string): number {
    const key = this.dataVersion + ':' + this.libVersion + ':' + this.viewVersion;
    if (this.viewCache.key !== key) {
      const counts = new Map<string, number>();
      this.viewItems.forEach(item => {
        this.getEffective(item).all.forEach(t => counts.set(t, (counts.get(t) || 0) + 1));
      });
      this.byName.forEach((node, n) => {
        if (node.encapsulate && node.children && node.children.length) {
          let c = 0;
          this.viewItems.forEach(item => { if (this.matches(item, n)) { c++; } });
          counts.set('\u0000enc:' + n, c);
        }
      });
      this.viewCache = { key, counts };
    }
    const node = this.byName.get(name);
    if (node && node.encapsulate && node.children && node.children.length) {
      return this.viewCache.counts.get('\u0000enc:' + name) || 0;
    }
    return this.viewCache.counts.get(name) || 0;
  }

  getCount(name: string): number {
    const items = this.imageElementService.imageElements;
    const key = this.dataVersion + ':' + this.libVersion + ':' + items.length;
    if (this.countsCache.key !== key) {
      const counts = new Map<string, number>();
      const live = items.filter(i => !i.deleted);
      live.forEach(item => {
        this.getEffective(item).all.forEach(t => counts.set(t, (counts.get(t) || 0) + 1));
      });
      // encapsulating tags
      this.byName.forEach((node, n) => {
        if (node.encapsulate && node.children && node.children.length) {
          let c = 0;
          live.forEach(item => { if (this.matches(item, n)) { c++; } });
          counts.set('\u0000enc:' + n, c);
        }
      });
      this.countsCache = { key, counts };
    }
    const node = this.byName.get(name);
    if (node && node.encapsulate && node.children && node.children.length) {
      return this.countsCache.counts.get('\u0000enc:' + name) || 0;
    }
    return this.countsCache.counts.get(name) || 0;
  }

  badgesFor(item: ImageElement): { name: string, icon?: string, mode: TagBadgeMode }[] {
    if (!item) {
      return [];
    }
    const out: { name: string, icon?: string, mode: TagBadgeMode }[] = [];
    // order of badges follows the order of the tag tree
    const all = this.getEffective(item).all;
    if (!all.size) {
      return out;
    }
    this.orderedNames().forEach(n => {
      if (all.has(n)) {
        const node = this.byName.get(n);
        if (node.badge) {
          const mode: TagBadgeMode = node.badge === 'icon' && !node.icon ? 'name' : node.badge;
          out.push({ name: n, icon: node.icon, mode });
        }
      }
    });
    return out;
  }

  private orderedCache: { v: number, names: string[] } = { v: -1, names: [] };

  orderedNames(): string[] {
    if (this.orderedCache.v !== this.libVersion) {
      const names: string[] = [];
      const walk = (nodes: TagNode[]) => nodes.forEach(n => {
        if (n.type !== 'separator') {
          names.push(n.name);
        }
        if (n.children) {
          walk(n.children);
        }
      });
      walk(this.lib.roots);
      this.orderedCache = { v: this.libVersion, names };
    }
    return this.orderedCache.names;
  }

  // ===========================================================================================
  // Activation (filter)
  // ===========================================================================================

  /** plain click: only this tag; ctrl: add / remove; shift: exclude */
  activate(name: string, mode: 'replace' | 'toggle' | 'exclude'): void {
    if (mode === 'exclude') {
      this.active = this.active.filter(t => t !== name);
      this.excluded = this.excluded.includes(name)
        ? this.excluded.filter(t => t !== name)
        : [...this.excluded, name];
    } else if (mode === 'toggle') {
      this.excluded = this.excluded.filter(t => t !== name);
      this.active = this.active.includes(name)
        ? this.active.filter(t => t !== name)
        : [...this.active, name];
    } else {
      if (this.active.length === 1 && this.active[0] === name && !this.excluded.length) {
        this.active = [];
      } else {
        this.active = [name];
        this.excluded = [];
      }
    }
    this.filterVersion++;
  }

  /** ZAWIERA <-> UNIKA */
  toggleMode(name: string): void {
    if (this.active.includes(name)) {
      this.active = this.active.filter(t => t !== name);
      this.excluded = [...this.excluded, name];
    } else if (this.excluded.includes(name)) {
      this.excluded = this.excluded.filter(t => t !== name);
      this.active = [...this.active, name];
    }
    this.filterVersion++;
  }

  deactivate(name: string): void {
    this.active = this.active.filter(t => t !== name);
    this.excluded = this.excluded.filter(t => t !== name);
    this.filterVersion++;
  }

  clearFilter(): void {
    this.active = [];
    this.excluded = [];
    this.folderFilter = null;
    this.dupMode = false;
    this.filterVersion++;
  }

  toggleUnionMode(): void {
    this.lib.unionMode = !this.lib.unionMode;
    this.filterVersion++;
    this.scheduleSave();
  }

  toggleShowHidden(): void {
    this.lib.showHidden = !this.lib.showHidden;
    this.libVersion++;
    this.scheduleSave();
  }

  // ===========================================================================================
  // Assigning tags to files / folders
  // ===========================================================================================

  addTagTo(items: ImageElement[], name: string): number {
    let n = 0;
    items.forEach(item => {
      if (!item || item.cleanName === '*FOLDER*') {
        return;
      }
      if (!item.tags || !item.tags.includes(name)) {
        this.manualTagsService.addTag(name);
        this.imageElementService.HandleEmission({ type: 'add', index: item.index, tag: name });
        n++;
      }
    });
    this.ensureTag(name);
    this.touchData();
    return n;
  }

  removeTagFrom(items: ImageElement[], name: string): number {
    let n = 0;
    items.forEach(item => {
      if (item && item.tags && item.tags.includes(name)) {
        this.manualTagsService.removeTag(name);
        this.imageElementService.HandleEmission({ type: 'remove', index: item.index, tag: name });
        n++;
      }
    });
    this.touchData();
    return n;
  }

  /** if every item has the tag directly -> remove from all, else add to missing */
  toggleTagOn(items: ImageElement[], name: string): void {
    const files = items.filter(i => i && i.cleanName !== '*FOLDER*');
    if (!files.length) {
      return;
    }
    if (files.every(i => i.tags && i.tags.includes(name))) {
      this.removeTagFrom(files, name);
    } else {
      this.addTagTo(files, name);
    }
  }

  tagFolder(partialPath: string, name: string): void {
    const arr = this.folderTags[partialPath] || [];
    if (!arr.includes(name)) {
      this.folderTags[partialPath] = [...arr, name];
      this.ensureTag(name);
      this.imageElementService.finalArrayNeedsSaving = true;
      this.touchData();
    }
  }

  untagFolder(partialPath: string, name: string): void {
    const arr = this.folderTags[partialPath] || [];
    if (arr.includes(name)) {
      this.folderTags[partialPath] = arr.filter(t => t !== name);
      if (!this.folderTags[partialPath].length) {
        delete this.folderTags[partialPath];
      }
      this.imageElementService.finalArrayNeedsSaving = true;
      this.touchData();
    }
  }

  // ---------- folder renamed / moved outside VHA: tagged folders follow their files ----------

  private pathMoves: { from: string, to: string }[] = [];
  private pathMoveTimer: any;

  /** called when a re-appearing file (same hash) moved from one folder to another */
  notePathMove(from: string, to: string): void {
    if (from === to) {
      return;
    }
    this.pathMoves.push({ from, to });
    clearTimeout(this.pathMoveTimer);
    this.pathMoveTimer = setTimeout(() => this.applyPathMoves(), 1500);
  }

  private applyPathMoves(): void {
    const moves = this.pathMoves;
    this.pathMoves = [];
    if (!moves.length) {
      return;
    }
    const live = this.imageElementService.imageElements.filter(e => !e.deleted && e.cleanName !== '*FOLDER*');
    let changed = false;
    Object.keys(this.folderTags).forEach(folder => {
      const stillUsed = live.some(e => e.partialPath === folder || e.partialPath.startsWith(folder + '/'));
      if (stillUsed) {
        return;
      }
      const votes = new Map<string, number>();
      moves.forEach(m => {
        if (m.from !== folder && !m.from.startsWith(folder + '/')) {
          return;
        }
        const rest = m.from.slice(folder.length);           // '' or '/sub/folders'
        if (!m.to.endsWith(rest)) {
          return;
        }
        const target = m.to.slice(0, m.to.length - rest.length);
        if (target) {
          votes.set(target, (votes.get(target) || 0) + 1);
        }
      });
      if (!votes.size) {
        return;
      }
      const target = Array.from(votes.entries()).sort((a, b) => b[1] - a[1])[0][0];
      const merged = this.folderTags[target] || [];
      this.folderTags[folder].forEach(t => { if (!merged.includes(t)) { merged.push(t); } });
      this.folderTags[target] = merged;
      delete this.folderTags[folder];
      changed = true;
    });
    if (changed) {
      this.imageElementService.finalArrayNeedsSaving = true;
      this.touchData();
    }
  }

  foldersWithTag(name: string): string[] {
    return Object.keys(this.folderTags).filter(k => this.folderTags[k].includes(name)).sort();
  }

  /** make sure the tag exists in the library (added at the bottom of the tree) */
  ensureTag(name: string): void {
    if (!this.loaded) {
      this.hubSyncPending = true;
      return;
    }
    if (!this.byName.has(name)) {
      const node = this.newNode(name);
      this.lib.roots.push(node);
      this.byName.set(name, node);
      this.parentOf.set(node, null);
      this.queueTouchLib();
    }
  }

  // ===========================================================================================
  // Editing the library
  // ===========================================================================================

  uniqueName(base: string): string {
    let name = base;
    let i = 2;
    while (this.byName.has(name)) {
      name = base + ' ' + i++;
    }
    return name;
  }

  /** where: 'child' of target, 'after' target, or root end when target is null */
  insertNode(node: TagNode, target: TagNode | null, where: 'child' | 'before' | 'after'): void {
    if (!target) {
      this.lib.roots.push(node);
    } else if (where === 'child') {
      target.children = target.children || [];
      target.children.push(node);
      target.collapsed = false;
    } else {
      const sib = this.siblingsOf(target);
      const idx = sib.indexOf(target);
      sib.splice(where === 'before' ? idx : idx + 1, 0, node);
    }
    this.touchLib();
  }

  moveNode(node: TagNode, target: TagNode | null, where: 'child' | 'before' | 'after'): boolean {
    if (node === target || (target && this.isAncestor(node, target))) {
      return false;
    }
    const from = this.siblingsOf(node);
    from.splice(from.indexOf(node), 1);
    const p = this.getParent(node);
    if (p && p.children && !p.children.length) {
      delete p.children;
    }
    this.reindex();
    this.insertNode(node, target, where);
    return true;
  }

  renameTag(node: TagNode, newName: string): string | null {
    newName = (newName || '').trim();
    const oldName = node.name;
    if (!newName || newName === oldName) {
      return null;
    }
    if (this.byName.has(newName)) {
      return 'exists';
    }
    node.name = newName;

    // files
    let touched = false;
    this.imageElementService.imageElements.forEach(item => {
      if (item.tags && item.tags.includes(oldName)) {
        item.tags = item.tags.map(t => t === oldName ? newName : t);
        touched = true;
      }
    });
    // folders
    Object.keys(this.folderTags).forEach(k => {
      if (this.folderTags[k].includes(oldName)) {
        this.folderTags[k] = this.folderTags[k].map(t => t === oldName ? newName : t);
        touched = true;
      }
    });
    // filters
    this.active = this.active.map(t => t === oldName ? newName : t);
    this.excluded = this.excluded.map(t => t === oldName ? newName : t);
    // colors from the original VHA tag tray
    const color = this.manualTagsService.getTagColor(oldName);
    if (color) {
      this.manualTagsService.setTagColor(oldName, null);
      this.manualTagsService.setTagColor(newName, color);
    }
    if (touched) {
      this.rebuildManualTagCounts();
      this.imageElementService.finalArrayNeedsSaving = true;
    }
    this.touchLib();
    this.touchData();
    return null;
  }

  /** remove node; children move up to the node's place; tag removed from files & folders */
  deleteNode(node: TagNode): void {
    const sib = this.siblingsOf(node);
    const idx = sib.indexOf(node);
    sib.splice(idx, 1, ...(node.children || []));
    if (node.type !== 'separator') {
      const name = node.name;
      let touched = false;
      this.imageElementService.imageElements.forEach(item => {
        if (item.tags && item.tags.includes(name)) {
          item.tags = item.tags.filter(t => t !== name);
          touched = true;
        }
      });
      Object.keys(this.folderTags).forEach(k => {
        if (this.folderTags[k].includes(name)) {
          this.folderTags[k] = this.folderTags[k].filter(t => t !== name);
          if (!this.folderTags[k].length) {
            delete this.folderTags[k];
          }
          touched = true;
        }
      });
      this.active = this.active.filter(t => t !== name);
      this.excluded = this.excluded.filter(t => t !== name);
      if (touched) {
        this.rebuildManualTagCounts();
        this.imageElementService.finalArrayNeedsSaving = true;
      }
    }
    this.touchLib();
    this.touchData();
  }

  /** copy: same name + ' (kopia)', icon and attributes; files tagged with the original get the copy too */
  duplicateNode(node: TagNode): TagNode {
    const copy: TagNode = {
      ...JSON.parse(JSON.stringify(node)),
      id: this.uuid(),
      name: this.uniqueName(node.name + ' (2)'),
      children: undefined,
      hotkey: undefined,
    };
    const sib = this.siblingsOf(node);
    sib.splice(sib.indexOf(node) + 1, 0, copy);
    this.touchLib();
    const items = this.imageElementService.imageElements.filter(i => i.tags && i.tags.includes(node.name));
    if (items.length) {
      this.addTagTo(items, copy.name);
    }
    Object.keys(this.folderTags).forEach(k => {
      if (this.folderTags[k].includes(node.name)) {
        this.folderTags[k] = [...this.folderTags[k], copy.name];
      }
    });
    this.touchData();
    return copy;
  }

  setIcon(node: TagNode, icon: string): void {
    icon = (icon || '').trim();
    if (icon) {
      node.icon = icon;
      this.lib.recentIcons = [icon, ...this.lib.recentIcons.filter(i => i !== icon)].slice(0, 60);
    } else {
      delete node.icon;
    }
    this.touchLib();
  }

  // ---------- WsQ: gallery selection (not saved) ----------

  selection: ImageElement[] = [];
  selectionAnchor: ImageElement | null = null;
  selVersion = 0;

  setSelection(items: ImageElement[], anchor?: ImageElement | null): void {
    this.selection = items.filter(i => i && i.cleanName !== '*FOLDER*');
    if (anchor !== undefined) {
      this.selectionAnchor = anchor;
    }
    this.selVersion++;
  }

  isSelected(item: ImageElement): boolean {
    return this.selection.includes(item);
  }

  noteRecentTag(name: string): void {
    this.lib.recentTags = [name, ...(this.lib.recentTags || []).filter(n => n !== name)].slice(0, 20);
    this.touchLib();
  }

  aliasMatches(name: string, q: string): boolean {
    const n = this.byName.get(name);
    return !!n && !!n.aliases && n.aliases.some(a => a.toLowerCase().includes(q));
  }

  removeRecentIcon(icon: string): void {
    this.lib.recentIcons = this.lib.recentIcons.filter(i => i !== icon);
    this.touchLib();
  }

  colorOf(name: string): string {
    return this.byName.get(name)?.color || '';
  }

  setColor(node: TagNode, color: string | null): void {
    if (color) {
      node.color = color;
    } else {
      delete node.color;
    }
    // the original VHA tag chips use the per-hub color map
    this.manualTagsService.setTagColor(node.name, color || null);
    this.imageElementService.finalArrayNeedsSaving = true;
    this.touchLib();
  }

  /** alphabetical (natural) order of the children; deep = all descendants */
  sortChildren(node: TagNode, deep: boolean): void {
    const cmp = (a: TagNode, b: TagNode) => {
      if (a.type === 'separator' || b.type === 'separator') {
        return 0;
      }
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    };
    const sortList = (list: TagNode[]) => {
      // keep separators as section breaks: sort each run between separators
      let start = 0;
      for (let i = 0; i <= list.length; i++) {
        if (i === list.length || list[i].type === 'separator') {
          const run = list.slice(start, i).sort(cmp);
          list.splice(start, run.length, ...run);
          start = i + 1;
        }
      }
      if (deep) {
        list.forEach(n => { if (n.children) { sortList(n.children); } });
      }
    };
    if (node.children) {
      sortList(node.children);
    }
    this.touchLib();
  }

  setAliases(node: TagNode, text: string): void {
    const aliases = (text || '').split(',').map(a => a.trim()).filter(a => a);
    if (aliases.length) {
      node.aliases = aliases;
    } else {
      delete node.aliases;
    }
    this.touchLib();
  }

  setHotkey(node: TagNode, key: string | null): void {
    // a hotkey can belong to only one tag
    const walk = (nodes: TagNode[]) => nodes.forEach(n => {
      if (key && n.hotkey === key) {
        delete n.hotkey;
      }
      if (n.children) {
        walk(n.children);
      }
    });
    walk(this.lib.roots);
    if (key) {
      node.hotkey = key;
    } else {
      delete node.hotkey;
    }
    this.touchLib();
  }

  tagForHotkey(key: string): TagNode | undefined {
    let found: TagNode;
    this.byName.forEach(n => { if (n.hotkey === key) { found = n; } });
    return found;
  }

  private rebuildManualTagCounts(): void {
    this.manualTagsService.removeAllTags();
    this.manualTagsService.populateManualTagsService(this.imageElementService.imageElements);
  }


  // ===========================================================================================
  // Import from Ritt
  // ===========================================================================================

  /** quick numbers for the confirmation dialog */
  rittStats(data: RittImportData): { tags: number, files: number, folders: number } {
    let tags = 0;
    const walk = (list: RittTag[]) => list.forEach(t => { if (!t.separator) { tags++; } walk(t.children); });
    walk(data.tags);
    return {
      tags,
      files: data.links.filter(l => l.kind === 'file').length,
      folders: data.links.filter(l => l.kind === 'folder').length,
    };
  }

  /**
   * Import the Ritt tag tree and its assignments.
   * Tags with the same name as an existing library tag replace it (its children move under the imported tag).
   * Files are matched by file name + as many parent folders as possible; folders by their path suffix.
   */
  importRitt(data: RittImportData): string[] {
    const report: string[] = [];
    const idToName = new Map<number, string>();
    const claimed = new Set<string>();   // names created in this import
    const created = new Set<TagNode>();

    const detachExisting = (name: string): TagNode[] => {
      const old = this.byName.get(name);
      if (!old) {
        return [];
      }
      const sib = this.siblingsOf(old);
      sib.splice(sib.indexOf(old), 1);
      this.byName.delete(name);
      return old.children || [];
    };

    const convert = (t: RittTag, parentName: string): TagNode => {
      if (t.separator) {
        return this.newSeparator();
      }
      let name = (t.name || '').trim() || 'tag';
      if (claimed.has(name)) {
        name = parentName ? name + ' (' + parentName + ')' : name;
        let i = 2;
        const base = name;
        while (claimed.has(name)) {
          name = base + ' ' + i++;
        }
      }
      claimed.add(name);
      idToName.set(t.id, name);
      const orphans = detachExisting(name);
      const node: TagNode = { id: this.uuid(), type: 'tag', name };
      created.add(node);
      if (t.icon) { node.icon = t.icon; }
      if (t.hidden) { node.hidden = true; }
      if (t.encapsulate) { node.encapsulate = true; }
      if (t.badge) { node.badge = t.icon ? 'icon' : 'name'; }
      if (t.hotkey) { node.hotkey = t.hotkey; }
      if (t.aliases && t.aliases.length) { node.aliases = t.aliases.slice(); }
      if (t.color) { node.color = t.color; }
      if (t.notes) { node.notes = t.notes; }
      if (t.inherit !== undefined) { node.inherit = t.inherit === null ? undefined : t.inherit; }
      const children = t.children.map(c => convert(c, name));
      const keep = orphans.filter(o => o.type === 'separator' || !claimed.has(o.name));
      if (children.length || keep.length) {
        node.children = [...children, ...keep];
        node.collapsed = true;
      }
      return node;
    };

    const imported = data.tags.map(t => convert(t, ''));
    // hot keys: one tag per key (imported tags win)
    const importedKeys = new Set<string>();
    const walkKeys = (nodes: TagNode[]) => nodes.forEach(n => { if (n.hotkey) { importedKeys.add(n.hotkey); } if (n.children) { walkKeys(n.children); } });
    walkKeys(imported);
    const clearKeys = (nodes: TagNode[]) => nodes.forEach(n => { if (n.hotkey && importedKeys.has(n.hotkey)) { delete n.hotkey; } if (n.children) { clearKeys(n.children); } });
    clearKeys(this.lib.roots);

    this.lib.roots = [...imported, ...this.lib.roots];
    // old tags with a name the import now uses: drop them, their children move up
    const dedupe = (nodes: TagNode[]): TagNode[] => {
      const out: TagNode[] = [];
      nodes.forEach(n => {
        if (n.children) {
          n.children = dedupe(n.children);
        }
        if (n.type !== 'separator' && claimed.has(n.name) && !created.has(n)) {
          out.push(...(n.children || []));
        } else {
          out.push(n);
        }
      });
      return out;
    };
    this.lib.roots = dedupe(this.lib.roots);
    this.reindex();
    report.push('Tagi: ' + claimed.size);

    // ---------- files ----------
    const norm = (x: string) => (x || '').toLowerCase();
    const items = this.imageElementService.imageElements.filter(i => !i.deleted && i.cleanName !== '*FOLDER*');
    const byFile = new Map<string, ImageElement[]>();
    const folderSet = new Set<string>();
    items.forEach(i => {
      const k = norm(i.fileName);
      if (!byFile.has(k)) { byFile.set(k, []); }
      byFile.get(k).push(i);
      this.folderAncestors(i.partialPath).forEach(f => folderSet.add(f));
    });
    const segsOf = (partialPath: string) => (partialPath || '').split('/').filter(x => x !== '').map(norm);
    const suffixMatch = (a: string[], b: string[]) => {
      let n = 0;
      while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) { n++; }
      return n;
    };

    const toAdd = new Map<ImageElement, Set<string>>();
    let filesMatched = 0;
    let filesMissing = 0;
    const missing: string[] = [];
    let foldersMatched = 0;
    let foldersMissing = 0;

    data.links.forEach(link => {
      const names = link.tags.map(id => idToName.get(id)).filter(n => !!n);
      if (!names.length) {
        return;
      }
      const rittSegs = link.path.map(norm);
      if (link.kind === 'file') {
        const cands = byFile.get(rittSegs[rittSegs.length - 1]) || [];
        if (!cands.length) {
          filesMissing++;
          if (missing.length < 15) { missing.push(link.path.join('/')); }
          return;
        }
        let best = -1;
        let chosen: ImageElement[] = [];
        cands.forEach(c => {
          const m = suffixMatch([...segsOf(c.partialPath), norm(c.fileName)], rittSegs);
          if (m > best) { best = m; chosen = [c]; } else if (m === best) { chosen.push(c); }
        });
        filesMatched++;
        chosen.forEach(c => {
          if (!toAdd.has(c)) { toAdd.set(c, new Set<string>()); }
          names.forEach(n => toAdd.get(c).add(n));
        });
      } else {
        if (!rittSegs.length) {
          foldersMissing++;
          return;
        }
        let best = 0;
        let chosen: string[] = [];
        folderSet.forEach(f => {
          const fs = segsOf(f);
          if (fs[fs.length - 1] !== rittSegs[rittSegs.length - 1]) {
            return;
          }
          const m = suffixMatch(fs, rittSegs);
          if (m > best) { best = m; chosen = [f]; } else if (m === best) { chosen.push(f); }
        });
        if (!chosen.length) {
          foldersMissing++;
          if (missing.length < 15) { missing.push(link.path.join('/') + '/'); }
          return;
        }
        foldersMatched++;
        chosen.forEach(f => {
          const arr = this.folderTags[f] || [];
          names.forEach(n => { if (!arr.includes(n)) { arr.push(n); } });
          this.folderTags[f] = arr;
        });
      }
    });

    let added = 0;
    toAdd.forEach((names, item) => {
      item.tags = item.tags || [];
      names.forEach(n => {
        if (!item.tags.includes(n)) {
          item.tags.push(n);
          added++;
        }
      });
    });
    this.rebuildManualTagCounts();
    this.imageElementService.finalArrayNeedsSaving = true;

    report.push('Pliki dopasowane: ' + filesMatched + (filesMissing ? ' (nie znaleziono: ' + filesMissing + ')' : '') + ', dodane przypisania: ' + added);
    report.push('Foldery dopasowane: ' + foldersMatched + (foldersMissing ? ' (nie znaleziono: ' + foldersMissing + ')' : ''));
    if (missing.length) {
      report.push('');
      report.push('Nieznalezione (pierwsze ' + missing.length + '):');
      missing.forEach(m => report.push('  ' + m));
    }
    if (data.unknownAttributes && data.unknownAttributes.length) {
      report.push('');
      report.push('Nieznane atrybuty Ritt (pominięte): ' + data.unknownAttributes.join(', '));
    }

    this.touchLib();
    this.touchData();
    this.saveNow();
    return report;
  }

}
