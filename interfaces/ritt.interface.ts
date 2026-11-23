// Data read from a Ritt database (*.ritt) -- see node/ritt-import.ts

export interface RittTag {
  id: number;
  name: string;
  icon: string;
  hidden: boolean;
  encapsulate: boolean;
  badge: boolean;
  separator: boolean;
  hotkey: string;
  children: RittTag[];
}

export interface RittLink {
  kind: 'file' | 'folder';
  path: string[];          // folders below the Ritt root folder + name, e.g. ['Aktorki', 'Alice Otsu', 'x.mkv']
  tags: number[];          // tag ids
}

export interface RittImportData {
  file: string;
  tags: RittTag[];
  links: RittLink[];
  unknownAttributes: string[];  // attribute keys we do not know (for debugging)
  error?: string;
}
