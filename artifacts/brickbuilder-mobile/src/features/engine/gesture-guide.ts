import type { MessageId } from "@/i18n/messages";
import type { ToolMode } from "@/features/editor/model";

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
      { title: "gesture.view.rotate.title", description: "gesture.view.rotate.description" },
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
      { title: "gesture.build.rotate.title", description: "gesture.build.rotate.description" },
    ],
  },
  {
    title: "gesture.section.delete",
    gestures: [
      { title: "gesture.delete.tap.title", description: "gesture.delete.tap.description" },
      { title: "gesture.delete.rotate.title", description: "gesture.delete.rotate.description" },
      { title: "gesture.delete.camera.title", description: "gesture.delete.camera.description" },
    ],
  },
];
