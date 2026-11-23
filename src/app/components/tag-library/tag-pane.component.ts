import { Component, ElementRef, HostListener, OnDestroy, input, output, viewChild } from '@angular/core';
import type { Subscription } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';

import { HOTKEYS, TagLibraryService } from './tag-library.service';
import { ImageElementService } from '../../services/image-element.service';

import type { FlatRow } from './tag-library.service';
import type { ImageElement } from '../../../../interfaces/final-object.interface';
import type { TagBadgeMode, TagNode } from '../../../../interfaces/tag-library.interface';

type DropZone = 'before' | 'after' | 'child';

const DRAG_TYPE = 'application/x-vha-tag-node';

// Common icons offered in the icon picker (Windows: Win + . opens the full emoji picker)
const PRESET_ICONS: string[] = [
  '🏷️', '⭐', '❤️', '🔥', '✅', '✔️', '❌', '💥', '🗑️', '📁', '📂', '🎬', '🎞️', '📼', '📺', '🎥',
  '🔞', '🔒', '🔓', '🛡️', '⚠️', '💤', '🕒', '📅', '🆕', '💯', '🎯', '🌍', '🌏', '🌎', '🗾', '🏯',
  '🍑', '🍒', '🍈', '🍉', '🍊', '🍋', '🍓', '🥥', '🥝', '🍎', '🍐', '🍇', '🌸', '🌹', '💋', '👄',
  '👩', '👱‍♀️', '👩‍🦰', '👩‍🦱', '👩‍🦳', '👧', '👵', '👨', '👴', '🧔', '👙', '👗', '👘', '👠', '🎀', '💎',
  '🇯🇵', '🇺🇸', '🇬🇧', '🇵🇱', '🇩🇪', '🇫🇷', '🇨🇿', '🇷🇺', '🇺🇦', '🇰🇷', '🇨🇳', '🇪🇸', '🇮🇹', '🇭🇺', '🇨🇦', '🇦🇺',
  '🇧🇪', '🇳🇱', '🇱🇻', '🇲🇹', '🇲🇽', '🇵🇷', '🇧🇷', '🇸🇪', '🇳🇴', '🇫🇮', '🇩🇰', '🇦🇹', '🇨🇭', '🇹🇭', '🇵🇭', '🇻🇳',
  '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '🟤', '⚫', '⚪', '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '⬛',
];

@Component({
  standalone: false,
  selector: 'app-tag-pane',
  templateUrl: './tag-pane.component.html',
  styleUrls: ['./tag-pane.component.scss'],
})
export class TagPaneComponent implements OnDestroy {

  readonly darkMode = input<boolean>(false);
  readonly batchMode = input<boolean>(false);
  readonly currentItem = input<ImageElement | null>(null);

  readonly favoritesOnly = input<boolean>(false);
  readonly filterChanged = output<void>();
  readonly favoritesToggle = output<void>();
  readonly hubsClick = output<void>();

  // ---------- WsQ: bookmarks (saved filter states) ----------
  addingBookmark = false;
  bookmarkName = '';

  startBookmark(): void {
    this.addingBookmark = true;
    this.bookmarkName = this.lib.active.concat(this.lib.excluded.map(t => '−' + t)).join(' ') || 'Zakładka';
    setTimeout(() => (this.host.nativeElement.querySelector('.bm-input') as HTMLInputElement)?.select());
  }

  saveBookmark(): void {
    const name = (this.bookmarkName || '').trim();
    if (name) {
      this.lib.lib.bookmarks = this.lib.lib.bookmarks || [];
      this.lib.lib.bookmarks.push({ name, active: this.lib.active.slice(), excluded: this.lib.excluded.slice() });
      this.lib.touchLib();
    }
    this.addingBookmark = false;
  }

  openBookmark(b: { active: string[], excluded: string[] }): void {
    this.lib.active = b.active.slice();
    this.lib.excluded = b.excluded.slice();
    this.lib.filterVersion++;
    this.filterChanged.emit();
  }

  removeBookmark(i: number, event: MouseEvent): void {
    event.stopPropagation();
    this.lib.lib.bookmarks.splice(i, 1);
    this.lib.touchLib();
  }

  isBookmarkActive(b: { active: string[], excluded: string[] }): boolean {
    return b.active.join('\u0000') === this.lib.active.join('\u0000')
        && b.excluded.join('\u0000') === this.lib.excluded.join('\u0000');
  }
  readonly tagsAssigned = output<void>();

  readonly filterInput = viewChild<ElementRef<HTMLInputElement>>('filterInput');

  filterText = '';
  selectedId = '';
  editingId = '';
  editText = '';
  editError = '';

  dropTargetId = '';
  dropZone: DropZone | '' = '';
  draggedNode: TagNode | null = null;

  menu: { x: number, y: number, node: TagNode | null } | null = null;
  iconEditor: { x: number, y: number, node: TagNode, text: string } | null = null;
  aliasEditor: { x: number, y: number, node: TagNode, text: string } | null = null;
  folderList: { x: number, y: number, node: TagNode } | null = null;
  colorEditor: { x: number, y: number, node: TagNode } | null = null;
  notesEditor: { x: number, y: number, node: TagNode, text: string } | null = null;
  helpPopup: { x: number, y: number } | null = null;

  colors: string[] = [
    '#e5534b', '#f0883e', '#d4a72c', '#57ab5a', '#39c5cf', '#4cb4ff', '#6c8cff', '#a371f7', '#db61a2', '#c69026',
    '#ffadad', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff', '#bdb2ff', '#ffc6ff', '#bbbbbb', '#ffffff',
  ];

  inheritOptions: { label: string, value: number | undefined }[] = [
    { label: 'TAGLIB.inheritNone', value: 0 },
    { label: 'TAGLIB.inherit1', value: 1 },
    { label: 'TAGLIB.inherit2', value: 2 },
    { label: 'TAGLIB.inherit3', value: 3 },
    { label: 'TAGLIB.inherit5', value: 5 },
    { label: 'TAGLIB.inheritAll', value: undefined },
  ];

  hotkeys = HOTKEYS;
  presetIcons = PRESET_ICONS;

  private rowsCache: { key: string, rows: FlatRow[] } = { key: '', rows: [] };

  constructor(
    public lib: TagLibraryService,
    private imageElementService: ImageElementService,
    private translate: TranslateService,
    private host: ElementRef<HTMLElement>,
  ) {
    this.rittSub = this.lib.rittImportReceived.subscribe(data => this.rittReceived(data));
  }

  private rittSub: Subscription;

  ngOnDestroy(): void {
    this.rittSub?.unsubscribe();
  }

  // =========================================================================================
  // Import from Ritt
  // =========================================================================================

  importRitt(): void {
    this.closePopups();
    this.lib.pickRittFile();
  }

  private rittReceived(data: any): void {
    if (data.error) {
      window.alert(this.t('rittError') + '\n\n' + data.error);
      return;
    }
    const st = this.lib.rittStats(data);
    if (!st.tags) {
      window.alert(this.t('rittEmpty'));
      return;
    }
    if (!window.confirm(this.t('rittConfirm', st))) {
      return;
    }
    const report = this.lib.importRitt(data);
    this.filterChanged.emit();
    this.tagsAssigned.emit();
    window.alert(this.t('rittDone') + '\n\n' + report.join('\n'));
  }

  t(key: string, params?: any): string {
    return this.translate.instant('TAGLIB.' + key, params);
  }

  get rows(): FlatRow[] {
    const key = this.lib.libVersion + '|' + this.filterText + '|' + (this.lib.lib.showHidden ? 1 : 0);
    if (this.rowsCache.key !== key) {
      this.rowsCache = { key, rows: this.lib.flatten(this.filterText) };
    }
    return this.rowsCache.rows;
  }

  depthArray(depth: number): number[] {
    return Array.from({ length: depth }, (_, i) => i);
  }

  trackRow(_: number, row: FlatRow): string {
    return row.node.id;
  }

  // =========================================================================================
  // Targets for tagging
  // =========================================================================================

  selectedItems(): ImageElement[] {
    return this.imageElementService.imageElements.filter(i => i.selected && !i.deleted);
  }

  targets(): ImageElement[] {
    if (this.batchMode()) {
      return this.selectedItems();
    }
    const cur = this.currentItem();
    return cur && cur.cleanName !== '*FOLDER*' ? [cur] : [];
  }

  /** 'direct' | 'inherited' | 'none' | 'batch' | '' (no target) */
  circleState(node: TagNode): string {
    if (node.type === 'separator') {
      return '';
    }
    if (this.batchMode()) {
      return 'batch';
    }
    const cur = this.currentItem();
    if (!cur || cur.cleanName === '*FOLDER*') {
      return '';
    }
    const eff = this.lib.getEffective(cur);
    if (eff.direct.includes(node.name)) {
      return 'direct';
    }
    if (eff.all.has(node.name)) {
      return 'inherited';
    }
    return 'none';
  }

  circleClick(event: MouseEvent, node: TagNode): void {
    event.stopPropagation();
    const items = this.targets();
    if (!items.length) {
      return;
    }
    this.lib.toggleTagOn(items, node.name);
    this.tagsAssigned.emit();
  }

  // =========================================================================================
  // Row interaction
  // =========================================================================================

  rowClick(event: MouseEvent, row: FlatRow): void {
    const node = row.node;
    this.selectedId = node.id;
    this.closePopups();
    if (node.type === 'separator' || this.editingId) {
      return;
    }
    if (this.batchMode()) {
      const sel = this.selectedItems();
      if (sel.length) {
        this.lib.addTagTo(sel, node.name);
        this.tagsAssigned.emit();
      }
      return;
    }
    if (event.shiftKey) {
      this.lib.activate(node.name, 'exclude');
    } else if (event.ctrlKey || event.metaKey) {
      this.lib.activate(node.name, 'toggle');
    } else {
      this.lib.activate(node.name, 'replace');
    }
    this.filterChanged.emit();
  }

  rowAuxClick(event: MouseEvent, row: FlatRow): void {
    if (event.button === 1 && row.node.type !== 'separator') { // middle click = add to active tags
      event.preventDefault();
      this.lib.activate(row.node.name, 'toggle');
      this.filterChanged.emit();
    }
  }

  toggleCollapse(event: MouseEvent, node: TagNode): void {
    event.stopPropagation();
    node.collapsed = !node.collapsed;
    this.lib.touchLib();
  }

  isActive(node: TagNode): boolean {
    return this.lib.active.includes(node.name);
  }

  isExcluded(node: TagNode): boolean {
    return this.lib.excluded.includes(node.name);
  }

  collapseAll(collapse: boolean): void {
    const walk = (nodes: TagNode[]) => nodes.forEach(n => {
      if (n.children && n.children.length) {
        n.collapsed = collapse;
        walk(n.children);
      }
    });
    walk(this.lib.lib.roots);
    this.lib.touchLib();
  }

  // =========================================================================================
  // Create / rename / delete
  // =========================================================================================

  addTag(target: TagNode | null, where: 'child' | 'after' | 'before'): void {
    this.closePopups();
    const node = this.lib.newNode(this.lib.uniqueName(this.t('newTagName')));
    this.lib.insertNode(node, target, where);
    this.selectedId = node.id;
    this.startRename(node);
  }

  addSeparator(target: TagNode | null): void {
    this.closePopups();
    this.lib.insertNode(this.lib.newSeparator(), target, 'after');
  }

  startRename(node: TagNode): void {
    if (node.type === 'separator') {
      return;
    }
    this.closePopups();
    this.editingId = node.id;
    this.editText = node.name;
    this.editError = '';
    setTimeout(() => {
      const el = this.host.nativeElement.querySelector('.rename-input') as HTMLInputElement;
      if (el) {
        el.focus();
        el.select();
      }
    });
  }

  commitRename(node: TagNode): void {
    if (this.editingId !== node.id) {
      return;
    }
    const res = this.lib.renameTag(node, this.editText);
    if (res === 'exists') {
      this.editError = this.t('nameExists');
      return;
    }
    this.editingId = '';
    this.editError = '';
    this.filterChanged.emit();
  }

  cancelRename(): void {
    this.editingId = '';
    this.editError = '';
  }

  deleteNode(node: TagNode): void {
    this.closePopups();
    if (node.type === 'separator') {
      this.lib.deleteNode(node);
      return;
    }
    const count = this.lib.getCount(node.name);
    const msg = this.t('confirmDelete', { name: node.name, count });
    if (window.confirm(msg)) {
      this.lib.deleteNode(node);
      this.filterChanged.emit();
      this.tagsAssigned.emit();
    }
  }

  duplicate(node: TagNode): void {
    this.closePopups();
    const copy = this.lib.duplicateNode(node);
    this.selectedId = copy.id;
    this.startRename(copy);
  }

  // =========================================================================================
  // Attributes
  // =========================================================================================

  setBadge(node: TagNode, mode: TagBadgeMode | null): void {
    if (mode) {
      node.badge = mode;
    } else {
      delete node.badge;
    }
    this.lib.touchLib();
  }

  toggleEncapsulate(node: TagNode): void {
    node.encapsulate = !node.encapsulate;
    if (!node.encapsulate) {
      delete node.encapsulate;
    }
    this.lib.touchLib();
    this.filterChanged.emit();
  }

  toggleHidden(node: TagNode): void {
    node.hidden = !node.hidden;
    if (!node.hidden) {
      delete node.hidden;
    }
    this.lib.touchLib();
  }

  setHotkey(node: TagNode, key: string | null): void {
    this.lib.setHotkey(node, node.hotkey === key ? null : key);
  }

  // =========================================================================================
  // Popups
  // =========================================================================================

  private popupPos(event: MouseEvent, w: number, h: number): { x: number, y: number } {
    let x = event.clientX;
    let y = event.clientY;
    if (x + w > window.innerWidth - 8) {
      x = window.innerWidth - w - 8;
    }
    if (y + h > window.innerHeight - 8) {
      y = Math.max(8, window.innerHeight - h - 8);
    }
    return { x, y };
  }

  openMenu(event: MouseEvent, node: TagNode | null): void {
    event.preventDefault();
    event.stopPropagation();
    this.closePopups();
    if (node) {
      this.selectedId = node.id;
    }
    const p = this.popupPos(event, 250, node ? (node.type === 'separator' ? 90 : 560) : 130);
    this.menu = { ...p, node };
  }

  openIconEditor(event: MouseEvent, node: TagNode): void {
    const p = this.popupPos(event, 300, 360);
    this.closePopups();
    this.iconEditor = { ...p, node, text: node.icon || '' };
    setTimeout(() => (this.host.nativeElement.querySelector('.icon-input') as HTMLInputElement)?.focus());
  }

  pickIcon(icon: string): void {
    if (this.iconEditor) {
      this.lib.setIcon(this.iconEditor.node, icon);
      this.iconEditor = null;
    }
  }

  openAliasEditor(event: MouseEvent, node: TagNode): void {
    const p = this.popupPos(event, 300, 140);
    this.closePopups();
    this.aliasEditor = { ...p, node, text: (node.aliases || []).join(', ') };
    setTimeout(() => (this.host.nativeElement.querySelector('.alias-input') as HTMLInputElement)?.focus());
  }

  saveAliases(): void {
    if (this.aliasEditor) {
      this.lib.setAliases(this.aliasEditor.node, this.aliasEditor.text);
      this.aliasEditor = null;
    }
  }

  openFolderList(event: MouseEvent, node: TagNode): void {
    const p = this.popupPos(event, 340, 300);
    this.closePopups();
    this.folderList = { ...p, node };
  }

  inheritLabel(node: TagNode): string {
    if (node.inherit === undefined) {
      return '∞';
    }
    return node.inherit === 0 ? '–' : String(node.inherit);
  }

  setInherit(node: TagNode, value: number | undefined): void {
    if (value === undefined) {
      delete node.inherit;
    } else {
      node.inherit = value;
    }
    this.lib.touchLib();
    this.lib.touchData();
    this.closePopups();
    this.tagsAssigned.emit();
  }

  openColorEditor(event: MouseEvent, node: TagNode): void {
    const p = this.popupPos(event, 260, 150);
    this.closePopups();
    this.colorEditor = { ...p, node };
  }

  pickColor(color: string | null): void {
    if (this.colorEditor) {
      this.lib.setColor(this.colorEditor.node, color);
      this.colorEditor = null;
      this.tagsAssigned.emit();
    }
  }

  openNotesEditor(event: MouseEvent, node: TagNode): void {
    const p = this.popupPos(event, 320, 220);
    this.closePopups();
    this.notesEditor = { ...p, node, text: node.notes || '' };
    setTimeout(() => (this.host.nativeElement.querySelector('.notes-input') as HTMLTextAreaElement)?.focus());
  }

  saveNotes(): void {
    if (this.notesEditor) {
      const text = (this.notesEditor.text || '').trim();
      if (text) {
        this.notesEditor.node.notes = text;
      } else {
        delete this.notesEditor.node.notes;
      }
      this.lib.touchLib();
      this.notesEditor = null;
    }
  }

  openHelp(event: MouseEvent): void {
    const p = this.popupPos(event, 360, 260);
    this.closePopups();
    this.helpPopup = p;
  }

  sortChildren(node: TagNode, deep: boolean): void {
    this.closePopups();
    this.lib.sortChildren(node, deep);
  }

  rowTitle(node: TagNode): string {
    const parts: string[] = [];
    if (node.aliases && node.aliases.length) {
      parts.push('@ ' + node.aliases.join(', '));
    }
    if (node.notes) {
      parts.push(node.notes);
    }
    return parts.join('\n');
  }

  closePopups(): void {
    this.colorEditor = null;
    this.notesEditor = null;
    this.helpPopup = null;
    this.menu = null;
    this.iconEditor = null;
    this.aliasEditor = null;
    this.folderList = null;
  }

  // =========================================================================================
  // Drag & drop inside the tree (and to the gallery)
  // =========================================================================================

  dragStart(event: DragEvent, node: TagNode): void {
    this.draggedNode = node;
    event.dataTransfer.setData(DRAG_TYPE, node.id);
    if (node.type !== 'separator') {
      event.dataTransfer.setData('text/plain', node.name); // drop on a video / folder = tag it
    }
    event.dataTransfer.effectAllowed = 'copyMove';
  }

  dragEnd(): void {
    this.draggedNode = null;
    this.dropTargetId = '';
    this.dropZone = '';
  }

  dragOver(event: DragEvent, row: FlatRow): void {
    if (!this.draggedNode || this.draggedNode === row.node || this.lib.isAncestor(this.draggedNode, row.node)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const el = event.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const y = event.clientY - rect.top;
    let zone: DropZone;
    if (row.node.type === 'separator') {
      zone = y < rect.height / 2 ? 'before' : 'after';
    } else if (y < rect.height * 0.25) {
      zone = 'before';
    } else if (y > rect.height * 0.75) {
      zone = 'after';
    } else {
      zone = 'child';
    }
    this.dropTargetId = row.node.id;
    this.dropZone = zone;
  }

  drop(event: DragEvent, row: FlatRow): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.draggedNode && this.dropZone) {
      this.lib.moveNode(this.draggedNode, row.node, this.dropZone as DropZone);
    }
    this.dragEnd();
  }

  dragOverEmpty(event: DragEvent): void {
    if (this.draggedNode) {
      event.preventDefault();
      this.dropTargetId = '';
      this.dropZone = '';
    }
  }

  dropOnEmpty(event: DragEvent): void {
    event.preventDefault();
    if (this.draggedNode) {
      this.lib.moveNode(this.draggedNode, null, 'after');
    }
    this.dragEnd();
  }

  // =========================================================================================
  // Keyboard (only when the pane has focus)
  // =========================================================================================

  keydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      return;
    }
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && (key === 'n' || key === 'm')) {
      event.preventDefault();
      event.stopPropagation();   // Ctrl+N is "new hub" elsewhere in VHA
      const sel = this.findSelected();
      if (key === 'n') {
        this.addTag(sel, sel ? 'after' : 'after');
      } else if (sel && sel.type !== 'separator') {
        this.addTag(sel, 'child');
      }
      return;
    }
    const node = this.findSelected();
    if (!node) {
      return;
    }
    if (event.key === 'F2') {
      event.preventDefault();
      this.startRename(node);
    } else if (event.key === 'Delete') {
      event.preventDefault();
      this.deleteNode(node);
    }
  }

  private findSelected(): TagNode | null {
    const row = this.rows.find(r => r.node.id === this.selectedId);
    return row ? row.node : null;
  }

  @HostListener('document:mousedown', ['$event'])
  docMouseDown(event: MouseEvent): void {
    const t = event.target as HTMLElement;
    if (t && t.closest && t.closest('.tp-popup')) {
      return;
    }
    if (this.menu || this.iconEditor || this.aliasEditor || this.folderList || this.colorEditor || this.notesEditor || this.helpPopup) {
      this.closePopups();
    }
  }

  @HostListener('document:keydown.escape')
  escape(): void {
    this.closePopups();
  }

  focusFilter(): void {
    this.filterInput()?.nativeElement.focus();
  }

}
