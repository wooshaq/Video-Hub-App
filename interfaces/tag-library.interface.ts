// Ritt-style tag library (global, stored in `tag-library.json` next to `settings.json`)

export type TagBadgeMode = 'icon' | 'name' | 'both';

export interface TagNode {
  id: string;
  type?: 'tag' | 'separator';   // default: 'tag'
  name: string;                 // tag text -- the same string stored in `ImageElement.tags`
  icon?: string;                // emoji (or any short text)
  aliases?: string[];           // other names -- used in tag search & auto-tagging
  badge?: TagBadgeMode;         // show on items in the gallery
  encapsulate?: boolean;        // activating the tag also shows items tagged with its children
  hidden?: boolean;             // hidden from the tag pane (unless "show hidden" is on)
  hotkey?: string;              // '1' ... '9', '0'
  inherit?: number;             // folder inheritance depth: undefined = all levels, 0 = none, n = n levels
  color?: string;               // hex color of the tag
  notes?: string;               // free-form notes
  collapsed?: boolean;
  children?: TagNode[];
}

export interface TagLibrary {
  version: 1;
  roots: TagNode[];
  recentIcons: string[];
  unionMode?: boolean;          // false = intersection (default), true = union
  showHidden?: boolean;
  paneWidth?: number;
}

export function NewTagLibrary(): TagLibrary {
  return {
    version: 1,
    roots: [],
    recentIcons: [],
  };
}
