import { Component, ElementRef, HostListener, input, output, viewChild } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

import { HOTKEYS, TagLibraryService } from './tag-library.service';
import { ImageElementService } from '../../services/image-element.service';
import { PipeSideEffectService } from '../../pipes/pipe-side-effect.service';

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
export class TagPaneComponent {

  readonly darkMode = input<boolean>(false);
  readonly batchMode = input<boolean>(false);
  readonly currentItem = input<ImageElement | null>(null);

  readonly filterChanged = output<void>();
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

  hotkeys = HOTKEYS;
  presetIcons = PRESET_ICONS;

  private rowsCache: { key: string, rows: FlatRow[] } = { key: '', rows: [] };

  constructor(
    public lib: TagLibraryService,
    private imageElementService: ImageElementService,
    private pipeSideEffectService: PipeSideEffectService,
    private translate: TranslateService,
    private host: ElementRef<HTMLElement>,
  ) { }

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
    const p = this.popupPos(event, 250, node ? (node.type === 'separator' ? 120 : 560) : 120);
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

  closePopups(): void {
    this.menu = null;
    this.iconEditor = null;
    this.aliasEditor = null;
    this.folderList = null;
  }

  // =========================================================================================
  // Auto-tagging
  // =========================================================================================

  autoTagItems(): ImageElement[] {
    if (this.batchMode() && this.selectedItems().length) {
      return this.selectedItems();
    }
    const showing = (this.pipeSideEffectService.galleryShowing || []) as ImageElement[];
    return showing.filter(i => i && i.cleanName !== '*FOLDER*');
  }

  runAutoTag(onlyTag?: string): void {
    this.closePopups();
    const items = this.autoTagItems();
    const [files, tags] = this.lib.previewAutoTag(items, onlyTag);
    if (!tags) {
      window.alert(this.t('autoTagNothing', { n: items.length }));
      return;
    }
    if (window.confirm(this.t('autoTagConfirm', { tags, files, n: items.length }))) {
      this.lib.autoTag(items, onlyTag);
      this.tagsAssigned.emit();
    }
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
    if (this.menu || this.iconEditor || this.aliasEditor || this.folderList) {
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
