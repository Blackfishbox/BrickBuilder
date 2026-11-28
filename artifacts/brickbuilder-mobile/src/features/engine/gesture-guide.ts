import type { MessageId } from "@/i18n/messages";
import type { ToolMode } from "@/features/editor/model";
import { CONTROL_SYMBOLS, type ControlSymbol } from "./control-symbols";
import type { CameraGestureBehavior } from "./camera-gesture";

export const DOUBLE_TAP_INTERVAL_MS = 500;
export const BUILD_SINGLE_TAP_DELAY_MS = DOUBLE_TAP_INTERVAL_MS + 80;
export const EMPTY_DOUBLE_TAP_ZOOM_FACTOR = 2;

export const EMPTY_DOUBLE_TAP_ZOOM_MODES: ReadonlySet<ToolMode> = new Set(["view", "select"]);

export interface GestureGuideLine {
  title: MessageId;
  description: MessageId;
}

export interface CameraGestureGuideLine extends GestureGuideLine {
  behavior: CameraGestureBehavior;
}

export interface GestureGuideSection {
  title: MessageId;
  gestures: readonly GestureGuideLine[];
}

export interface HelpButtonItem {
  icon?: ControlSymbol;
  title: MessageId;
  description: MessageId;
  additionalDescription?: MessageId;
}

export interface HelpButtonSection {
  title: MessageId;
  buttons: readonly HelpButtonItem[];
}

export const HELP_MODE_OVERVIEW: readonly HelpButtonItem[] = [
  { icon: CONTROL_SYMBOLS.viewMode, title: "editor.viewMode", description: "help.mode.view" },
  { icon: CONTROL_SYMBOLS.buildMode, title: "editor.buildMode", description: "help.mode.build" },
  { icon: CONTROL_SYMBOLS.selectMode, title: "editor.selectMode", description: "help.mode.select" },
  { icon: CONTROL_SYMBOLS.deleteMode, title: "editor.deleteMode", description: "help.mode.delete" },
];

/** Keep the button overview aligned with the controls rendered by App and BuilderCanvas. */
export const HELP_BUTTON_SECTIONS: readonly HelpButtonSection[] = [
  {
    title: "help.section.header",
    buttons: [
      { icon: CONTROL_SYMBOLS.projectMenu, title: "help.button.project", description: "help.button.project.description" },
      { icon: CONTROL_SYMBOLS.theme, title: "help.button.theme", description: "help.button.theme.description" },
      { icon: CONTROL_SYMBOLS.language, title: "language", description: "help.button.language.description" },
      { icon: CONTROL_SYMBOLS.gestureHelp, title: "gesture.help", description: "help.button.help.description" },
      { icon: CONTROL_SYMBOLS.save, title: "save.action", description: "help.button.save.description" },
    ],
  },
  {
    title: "help.section.workspace",
    buttons: [
      { icon: CONTROL_SYMBOLS.edges, title: "canvas.thickEdges", description: "help.button.edges.description" },
      { icon: CONTROL_SYMBOLS.undo, title: "history.undo", description: "help.button.undo.description" },
      { icon: CONTROL_SYMBOLS.redo, title: "history.redo", description: "help.button.redo.description" },
      { icon: CONTROL_SYMBOLS.colorMode, title: "editor.colorMode", description: "help.button.color.description" },
      { icon: CONTROL_SYMBOLS.partsTool, title: "editor.partsTool", description: "help.button.parts.description" },
      { icon: CONTROL_SYMBOLS.connections, title: "canvas.showConnections", description: "help.button.connections.description" },
      { icon: CONTROL_SYMBOLS.collisions, title: "canvas.showCollisionWarning", description: "help.button.collision.description" },
      { icon: CONTROL_SYMBOLS.floatingParts, title: "canvas.showFloatingWarning", description: "help.button.floating.description" },
    ],
  },
  {
    title: "help.section.selectedPart",
    buttons: [
      { icon: CONTROL_SYMBOLS.height, title: "help.button.height", description: "help.button.height.description" },
      { icon: CONTROL_SYMBOLS.finePosition, title: "fine.title", description: "help.button.fine.description" },
      { icon: CONTROL_SYMBOLS.group, title: "group.title", description: "help.button.group.description" },
      { icon: CONTROL_SYMBOLS.tilt, title: "tilt.title", description: "help.button.rotation.description" },
      { icon: CONTROL_SYMBOLS.removePart, title: "editor.remove", description: "help.button.delete.description" },
      { icon: CONTROL_SYMBOLS.buildSwitch, title: "help.button.buildSwitch", description: "help.button.buildSwitch.description" },
      { icon: CONTROL_SYMBOLS.connectedParts, title: "help.button.connectedParts", description: "help.button.connectedParts.description" },
      { icon: CONTROL_SYMBOLS.directMultiSelect, title: "help.button.directMultiSelect", description: "help.button.directMultiSelect.description" },
      { icon: CONTROL_SYMBOLS.tapSelect, title: "help.button.tapSelect", description: "help.button.tapSelect.description" },
    ],
  },
  {
    title: "help.section.projectMenu",
    buttons: [
      { icon: CONTROL_SYMBOLS.newProject, title: "project.newAction", description: "help.menu.new.description" },
      { icon: CONTROL_SYMBOLS.importProject, title: "project.import", description: "help.menu.import.description" },
      { icon: CONTROL_SYMBOLS.exportProject, title: "project.export", description: "help.menu.export.description" },
      {
        icon: CONTROL_SYMBOLS.instructions,
        title: "project.instructions",
        description: "help.menu.instructions.description",
        additionalDescription: "instruction.background.note",
      },
      { icon: CONTROL_SYMBOLS.storage, title: "project.storage", description: "help.menu.storage.description" },
      { icon: CONTROL_SYMBOLS.privacy, title: "project.privacy", description: "help.menu.privacy.description" },
      { title: "project.device", description: "help.menu.projects.description" },
    ],
  },
];

/** Keep these documented camera actions aligned with cameraGesture and BuilderCanvas. */
export const CAMERA_GESTURE_GUIDE: readonly CameraGestureGuideLine[] = [
  { behavior: "pan", title: "gesture.camera.pan.title", description: "gesture.camera.pan.description" },
  { behavior: "pinch", title: "gesture.camera.pinch.title", description: "gesture.camera.pinch.description" },
  { behavior: "twist", title: "gesture.camera.twist.title", description: "gesture.camera.twist.description" },
];

/** Keep this user-facing guide aligned with the pointer handlers in BuilderCanvas. */
export const GESTURE_GUIDE_SECTIONS: readonly GestureGuideSection[] = [
  {
    title: "gesture.section.camera",
    gestures: CAMERA_GESTURE_GUIDE,
  },
  {
    title: "gesture.section.mouse",
    gestures: [
      { title: "gesture.mouse.wheel.title", description: "gesture.mouse.wheel.description" },
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
