import { Injectable, NgZone } from '@angular/core';
import { Subject } from 'rxjs';

import { ImageElementService } from '../../services/image-element.service';
import { ManualTagsService } from '../tags-manual/manual-tags.service';

import type { ImageElement } from '../../../../interfaces/final-object.interface';
import type { TagBadgeMode, TagLibrary, TagNode } from '../../../../interfaces/tag-library.interface';
import { NewTagLibrary } from '../../../../interfaces/tag-library.interface';

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
    if (cached && cached.v === this.dataVersion && cached.sig === sig) {
      return cached.eff;
    }
    const direct = (item.tags || []).slice();
    const all = new Set<string>(direct);
    const inherited: string[] = [];
    if (item.cleanName === '*FOLDER*') {
      // folder pseudo-item: its own tags are "direct", parents' are inherited
      const own = this.folderTags[item.partialPath] || [];
      own.forEach(t => { if (!all.has(t)) { all.add(t); direct.push(t); } });
      this.folderAncestors(item.partialPath).slice(0, -1).forEach(f => {
        (this.folderTags[f] || []).forEach(t => {
          if (!all.has(t)) { all.add(t); inherited.push(t); }
        });
      });
    } else {
      this.folderAncestors(item.partialPath).forEach(f => {
        (this.folderTags[f] || []).forEach(t => {
          if (!all.has(t)) { all.add(t); inherited.push(t); }
        });
      });
    }
    const eff: EffectiveTags = { direct, inherited, all };
    this.effCache.set(item, { v: this.dataVersion, sig, eff });
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

  /** filter used by the gallery pipe */
  filter(items: ImageElement[]): ImageElement[] {
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
  computeRelated(results: ImageElement[]): void {
    if (!this.active.length && !this.excluded.length) {
      if (this.related.length) {
        Promise.resolve().then(() => this.related = []);
      }
      return;
    }
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

  deactivate(name: string): void {
    this.active = this.active.filter(t => t !== name);
    this.excluded = this.excluded.filter(t => t !== name);
    this.filterVersion++;
  }

  clearFilter(): void {
    this.active = [];
    this.excluded = [];
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
      this.lib.recentIcons = [icon, ...this.lib.recentIcons.filter(i => i !== icon)].slice(0, 40);
    } else {
      delete node.icon;
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
  // Auto-tagging -- tag names and aliases found in the file name
  // ===========================================================================================

  private termRegexCache = new Map<string, RegExp>();

  private termRegex(term: string): RegExp {
    if (this.termRegexCache.has(term)) {
      return this.termRegexCache.get(term);
    }
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // whole-word match when the term starts / ends with a letter or digit
    const pre = /^[\p{L}\p{N}]/u.test(term) ? '(?<![\\p{L}\\p{N}])' : '';
    const post = /[\p{L}\p{N}]$/u.test(term) ? '(?![\\p{L}\\p{N}])' : '';
    const re = new RegExp(pre + esc + post, 'iu');
    this.termRegexCache.set(term, re);
    return re;
  }

  /** tags suggested for a file (not already applied directly or inherited) */
  suggestFor(item: ImageElement): string[] {
    if (!item || item.cleanName === '*FOLDER*') {
      return [];
    }
    const eff = this.getEffective(item);
    const fileName = item.fileName || '';
    const out: string[] = [];
    this.byName.forEach((node, name) => {
      if (node.hidden || eff.all.has(name)) {
        return;
      }
      const terms = [name, ...(node.aliases || [])].filter(t => t && t.length >= 2);
      if (terms.some(t => this.termRegex(t).test(fileName))) {
        out.push(name);
      }
    });
    const order = this.orderedNames();
    out.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    return out;
  }

  /** returns [files changed, tags added] */
  autoTag(items: ImageElement[], onlyTag?: string): [number, number] {
    let files = 0;
    let tags = 0;
    items.forEach(item => {
      let s = this.suggestFor(item);
      if (onlyTag) {
        s = s.filter(t => t === onlyTag);
      }
      if (s.length) {
        files++;
        s.forEach(t => {
          if (!item.tags || !item.tags.includes(t)) {
            this.manualTagsService.addTag(t);
            this.imageElementService.HandleEmission({ type: 'add', index: item.index, tag: t });
            tags++;
          }
        });
      }
    });
    this.touchData();
    return [files, tags];
  }

  previewAutoTag(items: ImageElement[], onlyTag?: string): [number, number] {
    let files = 0;
    let tags = 0;
    items.forEach(item => {
      let s = this.suggestFor(item);
      if (onlyTag) {
        s = s.filter(t => t === onlyTag);
      }
      if (s.length) {
        files++;
        tags += s.length;
      }
    });
    return [files, tags];
  }

}
