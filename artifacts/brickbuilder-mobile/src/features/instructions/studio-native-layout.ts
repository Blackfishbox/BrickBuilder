import { Euler, Matrix4, OrthographicCamera, Quaternion, Vector3 } from "three";
import { setPdfDefaultCamera } from "./camera";
import type { InstructionStep } from "./types";
import type { BuilderDocument } from "../editor/model";
import { IDENTITY, multiply, referenceLine } from "../formats/ldraw/parser";

type Attributes = Record<string, string>;
export type NativeSlotRect = [number, number, number, number];

/** Studio's resize bars delimit normalized slots, including nested partial bars. */
export function studioResizeSlots(page: Attributes, slots: Attributes[]): NativeSlotRect[] | undefined {
  const tokens = page.resizeBars?.trim().split(/\s+/) ?? [];
  if (!tokens.length || tokens.length % 4) return undefined;
  const bars: { vertical: boolean; position: number }[] = [];
  for (let i = 0; i < tokens.length; i += 4) {
    const position = Number(tokens[i + 3]);
    if (!/^(true|false)$/i.test(tokens[i]) || !Number.isFinite(position) || position <= 0 || position >= 1) return undefined;
    bars.push({ vertical: tokens[i].toLowerCase() === "true", position });
  }
  const edge = (slot: Attributes, name: string, vertical: boolean, fallback: number): number => {
    if (slot[name] === undefined) return fallback;
    const index = Number(slot[name]);
    if (!Number.isInteger(index) || !bars[index] || bars[index].vertical !== vertical) return NaN;
    return bars[index].position;
  };
  const rects = slots.map(slot => {
    const left = edge(slot, "refResizeBarLeft", true, 0);
    const right = edge(slot, "refResizeBarRight", true, 1);
    const top = edge(slot, "refResizeBarTop", false, 0);
    const bottom = edge(slot, "refResizeBarBottom", false, 1);
    return [left, top, right - left, bottom - top] as NativeSlotRect;
  });
  return rects.every(rect => rect.every(Number.isFinite) && rect[2] > 0 && rect[3] > 0) ? rects : undefined;
}

function vector(value: string | undefined, length: number): number[] | undefined {
  const values = value?.trim().split(/\s+/).map(Number);
  return values?.length === length && values.every(Number.isFinite) ? values : undefined;
}

/** Include the source camera orbit, not just Studio's usually-zero modelAngle. */
export function studioPdfStep(step: InstructionStep, preview?: Attributes): InstructionStep {
  if (!preview || step.camera) return step;
  const camera = vector(preview.cameraAngle ?? preview.DefaultCameraControlInfo_cameraAngle, 2);
  if (!camera) return step;
  const model = step.rotation?.map(angle => angle * Math.PI / 180) ??
    vector(preview.modelAngle ?? preview.DefaultCameraControlInfo_modelAngle, 3) ?? [0, 0, 0];
  const theta = Math.PI - camera[1], phi = Math.PI / 2 + camera[0];
  const source = new OrthographicCamera();
  source.position.set(Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta));
  // Keep the source roll through either pole. lookAt's default +Y up vector
  // otherwise turns Studio underside views upside down.
  source.up.set(-Math.cos(phi) * Math.sin(theta), Math.sin(phi), -Math.cos(phi) * Math.cos(theta));
  source.lookAt(new Vector3());
  const reference = new OrthographicCamera();
  setPdfDefaultCamera(reference, 1);
  const orientation = reference.quaternion.clone().multiply(source.quaternion.clone().invert())
    .multiply(new Quaternion().setFromEuler(new Euler(...model as [number, number, number])));
  const angles = new Euler().setFromQuaternion(orientation, "XYZ");
  return {
    ...step,
    // Studio and our LDraw renderer use opposite handedness. The PDF mirrors
    // the resulting diagram horizontally; this is its corresponding observer.
    rotation: [angles.x, angles.y, angles.z].map(angle => angle * 180 / Math.PI) as [number, number, number],
  };
}

/** Studio's orthographic half-height is in LDU; the renderer uses 20 LDU per stud. */
export function studioFrameHeight(preview: Attributes | undefined, slotHeight: number, pageHeight: number): number | undefined {
  const scale = Number(preview?.cameraScale ?? preview?.DefaultCameraControlInfo_cameraScale);
  return Number.isFinite(scale) && scale > 0 && pageHeight > 0
    ? 2 * scale / 20 * slotHeight / pageHeight : undefined;
}

/** Callouts show a submodel in its own frame, not tilted in its parent assembly. */
export function studioCalloutStep(document: BuilderDocument, step: InstructionStep, ids: string[]): InstructionStep {
  const model = document.imported;
  if (!model) return step;
  const selected = new Set(ids);
  const paths = model.instances.filter(part => selected.has(part.id)).map(part => part.sourceOccurrence);
  if (!paths.length || paths.some(path => !path?.length)) return step;
  const prefix = paths[0]!.slice(0, -1);
  while (prefix.length && !paths.every(path => prefix.every((value, index) => path![index] === value))) prefix.pop();
  if (!prefix.length) return step;
  let section = model.root, affine = [...IDENTITY] as typeof IDENTITY;
  for (const index of prefix) {
    const line = model.sections[section]?.[index];
    if (!line || !/^\s*1\s/.test(line)) return step;
    const reference = referenceLine(line);
    affine = multiply(affine, reference.matrix);
    section = reference.reference.toLowerCase();
    if (!model.sections[section]) return step;
  }
  const parent = new Matrix4().set(
    affine[0], affine[1], affine[2], 0,
    affine[4], affine[5], affine[6], 0,
    affine[8], affine[9], affine[10], 0,
    0, 0, 0, 1,
  );
  if (Math.abs(parent.determinant()) < 1e-8) return step;
  const yFlip = new Matrix4().makeScale(1, -1, 1);
  parent.premultiply(yFlip).multiply(yFlip).invert();
  // Studio occurrence transforms can have tiny rounding-induced scale errors.
  const rotation = new Matrix4().extractRotation(parent);
  if (rotation.determinant() < 0) return step;
  const view = new Matrix4().makeRotationFromEuler(new Euler(
    ...(step.rotation ?? [0, 0, 0]).map(angle => angle * Math.PI / 180) as [number, number, number],
  )).multiply(rotation);
  const angles = new Euler().setFromRotationMatrix(view, "XYZ");
  return { ...step, rotation: [angles.x, angles.y, angles.z].map(angle => angle * 180 / Math.PI) as [number, number, number] };
}
