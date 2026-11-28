import type { ComponentType } from "react";
import {
  Cloud,
  CircleHelp,
  Eye,
  FileDown,
  FilePlus2,
  FileUp,
  Group,
  HardDrive,
  Hammer,
  Languages,
  Layers,
  Link2,
  Menu,
  MousePointer2,
  MousePointerClick,
  Move3d,
  PackageOpen,
  Palette,
  Plus,
  Rotate3d,
  Save,
  Scale,
  Sun,
  Trash2,
  TriangleAlert,
  Undo2,
  Redo2,
} from "lucide-react";

export type ControlSymbol = ComponentType<{ size?: number }>;

/** Shared by the real controls and their help examples. */
export function EdgeSample() {
  return <span className="thick-edges-sample" aria-hidden="true" />;
}

export function HeightArrows() {
  return <span className="height-arrows" aria-hidden="true"><HeightArrowUp /> <HeightArrowDown /></span>;
}

export function HeightArrowUp() {
  return <span aria-hidden="true">↑</span>;
}

export function HeightArrowDown() {
  return <span aria-hidden="true">↓</span>;
}

/** Single source of truth for symbols shown by controls and described in help. */
export const CONTROL_SYMBOLS = {
  viewMode: Eye,
  buildMode: Hammer,
  selectMode: MousePointer2,
  deleteMode: Trash2,
  projectMenu: Menu,
  theme: Sun,
  gestureHelp: CircleHelp,
  save: Save,
  edges: EdgeSample,
  undo: Undo2,
  redo: Redo2,
  colorMode: Palette,
  partsTool: Plus,
  connections: Link2,
  collisions: TriangleAlert,
  floatingParts: Cloud,
  height: HeightArrows,
  heightUp: HeightArrowUp,
  heightDown: HeightArrowDown,
  finePosition: Move3d,
  group: Group,
  tilt: Rotate3d,
  removePart: Trash2,
  buildSwitch: MousePointer2,
  connectedParts: Layers,
  directMultiSelect: MousePointerClick,
  tapSelect: MousePointer2,
  newProject: FilePlus2,
  importProject: FileUp,
  exportProject: FileDown,
  instructions: PackageOpen,
  storage: HardDrive,
  privacy: Scale,
  language: Languages,
} satisfies Record<string, ControlSymbol>;
