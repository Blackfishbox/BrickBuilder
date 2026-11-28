import type { MessageId } from "@/i18n/messages";
import type { ToolMode } from "@/features/editor/model";
import type { ComponentType } from "react";
import { EdgeSample, HeightArrows } from "./control-symbols";
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

export const DOUBLE_TAP_INTERVAL_MS = 500;
export const BUILD_SINGLE_TAP_DELAY_MS = DOUBLE_TAP_INTERVAL_MS + 80;
export const EMPTY_DOUBLE_TAP_ZOOM_FACTOR = 2;

export const EMPTY_DOUBLE_TAP_ZOOM_MODES: ReadonlySet<ToolMode> = new Set(["view", "select"]);

export interface GestureGuideLine {
  title: MessageId;
  description: MessageId;
}

export interface GestureGuideSection {
  title: MessageId;
  gestures: readonly GestureGuideLine[];
}

export interface HelpButtonItem {
  icon?: ComponentType<{ size?: number }>;
  title: MessageId;
  description: MessageId;
  additionalDescription?: MessageId;
}

export interface HelpButtonSection {
  title: MessageId;
  buttons: readonly HelpButtonItem[];
}

export const HELP_MODE_OVERVIEW: readonly HelpButtonItem[] = [
  { icon: Eye, title: "editor.viewMode", description: "help.mode.view" },
  { icon: Hammer, title: "editor.buildMode", description: "help.mode.build" },
  { icon: MousePointer2, title: "editor.selectMode", description: "help.mode.select" },
  { icon: Trash2, title: "editor.deleteMode", description: "help.mode.delete" },
];

/** Keep the button overview aligned with the controls rendered by App and BuilderCanvas. */
export const HELP_BUTTON_SECTIONS: readonly HelpButtonSection[] = [
  {
    title: "help.section.header",
    buttons: [
      { icon: Menu, title: "help.button.project", description: "help.button.project.description" },
      { icon: Sun, title: "help.button.theme", description: "help.button.theme.description" },
      { icon: CircleHelp, title: "gesture.help", description: "help.button.help.description" },
      { icon: Save, title: "save.action", description: "help.button.save.description" },
    ],
  },
  {
    title: "help.section.workspace",
    buttons: [
      { icon: EdgeSample, title: "canvas.thickEdges", description: "help.button.edges.description" },
      { icon: Undo2, title: "history.undo", description: "help.button.undo.description" },
      { icon: Redo2, title: "history.redo", description: "help.button.redo.description" },
      { icon: Palette, title: "editor.colorMode", description: "help.button.color.description" },
      { icon: Plus, title: "editor.partsTool", description: "help.button.parts.description" },
      { icon: Link2, title: "canvas.showConnections", description: "help.button.connections.description" },
      { icon: TriangleAlert, title: "canvas.showCollisionWarning", description: "help.button.collision.description" },
      { icon: Cloud, title: "canvas.showFloatingWarning", description: "help.button.floating.description" },
    ],
  },
  {
    title: "help.section.selectedPart",
    buttons: [
      { icon: HeightArrows, title: "help.button.height", description: "help.button.height.description" },
      { icon: Move3d, title: "fine.title", description: "help.button.fine.description" },
      { icon: Group, title: "group.title", description: "help.button.group.description" },
      { icon: Rotate3d, title: "tilt.title", description: "help.button.rotation.description" },
      { icon: Trash2, title: "editor.remove", description: "help.button.delete.description" },
      { icon: MousePointer2, title: "help.button.buildSwitch", description: "help.button.buildSwitch.description" },
      { icon: Layers, title: "help.button.connectedParts", description: "help.button.connectedParts.description" },
      { icon: MousePointerClick, title: "help.button.directMultiSelect", description: "help.button.directMultiSelect.description" },
      { icon: MousePointer2, title: "help.button.tapSelect", description: "help.button.tapSelect.description" },
    ],
  },
  {
    title: "help.section.projectMenu",
    buttons: [
      { icon: FilePlus2, title: "project.newAction", description: "help.menu.new.description" },
      { icon: FileUp, title: "project.import", description: "help.menu.import.description" },
      { icon: FileDown, title: "project.export", description: "help.menu.export.description" },
      {
        icon: PackageOpen,
        title: "project.instructions",
        description: "help.menu.instructions.description",
        additionalDescription: "instruction.background.note",
      },
      { icon: HardDrive, title: "project.storage", description: "help.menu.storage.description" },
      { icon: Scale, title: "project.privacy", description: "help.menu.privacy.description" },
      { icon: Languages, title: "language", description: "help.menu.language.description" },
      { title: "project.device", description: "help.menu.projects.description" },
    ],
  },
];

/** Keep this user-facing guide aligned with the pointer handlers in BuilderCanvas. */
export const GESTURE_GUIDE_SECTIONS: readonly GestureGuideSection[] = [
  {
    title: "gesture.section.camera",
    gestures: [
      { title: "gesture.camera.pan.title", description: "gesture.camera.pan.description" },
      { title: "gesture.camera.pinch.title", description: "gesture.camera.pinch.description" },
      { title: "gesture.camera.twist.title", description: "gesture.camera.twist.description" },
    ],
  },
  {
    title: "gesture.section.controls",
    gestures: [
      { title: "gesture.controls.slider.title", description: "gesture.controls.slider.description" },
    ],
  },
  {
    title: "gesture.section.view",
    gestures: [
      { title: "gesture.view.tap.title", description: "gesture.view.tap.description" },
      { title: "gesture.view.orbit.title", description: "gesture.view.orbit.description" },
      { title: "gesture.view.zoom.title", description: "gesture.view.zoom.description" },
      { title: "gesture.view.doubleTapPart.title", description: "gesture.view.doubleTapPart.description" },
    ],
  },
  {
    title: "gesture.section.select",
    gestures: [
      { title: "gesture.select.tap.title", description: "gesture.select.tap.description" },
      { title: "gesture.select.drag.title", description: "gesture.select.drag.description" },
      { title: "gesture.select.camera.title", description: "gesture.select.camera.description" },
      { title: "gesture.select.zoom.title", description: "gesture.select.zoom.description" },
      { title: "gesture.select.rotate.title", description: "gesture.select.rotate.description" },
    ],
  },
  {
    title: "gesture.section.build",
    gestures: [
      { title: "gesture.build.tap.title", description: "gesture.build.tap.description" },
      { title: "gesture.build.drag.title", description: "gesture.build.drag.description" },
      { title: "gesture.build.doubleTap.title", description: "gesture.build.doubleTap.description" },
      { title: "gesture.build.toggle.title", description: "gesture.build.toggle.description" },
      { title: "gesture.build.doubleTapPart.title", description: "gesture.build.doubleTapPart.description" },
    ],
  },
  {
    title: "gesture.section.delete",
    gestures: [
      { title: "gesture.delete.tap.title", description: "gesture.delete.tap.description" },
      { title: "gesture.delete.doubleTap.title", description: "gesture.delete.doubleTap.description" },
      { title: "gesture.delete.camera.title", description: "gesture.delete.camera.description" },
    ],
  },
];
