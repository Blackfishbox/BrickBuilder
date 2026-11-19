import { Box3, BufferGeometry, Color, Euler, Matrix4, OrthographicCamera, Vector3 } from "three";
import type { BuilderDocument } from "../editor/model";
import { brickTransformMatrix } from "../editor/brick-transform";
import { createLocalBrickGeometry } from "../engine/local-brick-geometry";
import { compilePart, worldMatrix } from "../engine/ldraw-geometry";
import { instructionDisplayColor } from "./highlight-color";
import { resolveColor } from "../formats/colors";
import type { InstructionImageRenderer } from "./render";
import { drawInstructionOutlines, groupInstructionHighlights, instructionHighlightOccurrences, instructionGroupBounds } from "./outlines";
import { applyPdfStepCamera } from "./camera";

const MAX_TRIANGLES = 120_000;
interface Face { id: string; points: Float32Array; color: string; alpha: number }

/**
 * Exact source triangles, not the interactive renderer's sampled fallback.
 * Refuse the export above a bounded CPU budget instead of omitting surfaces.
 */
export async function createSoftwareInstructionRenderer(document: BuilderDocument, signal?: AbortSignal,
  size: { width: number; height: number; minRadius?: number } = { width: 1000, height: 760, minRadius: 1 }): Promise<InstructionImageRenderer> {
  const canvas = globalThis.document.createElement("canvas");
  canvas.width = size.width; canvas.height = size.height;
  const width = canvas.width, height = canvas.height, aspect = width / height;
  const context = canvas.getContext("2d");
  if (!context) {
    canvas.width = 1; canvas.height = 1;
    throw new Error("PDF-Abbildungen sind nicht verfügbar: Weder WebGL noch die 2D-Ausgabe konnten gestartet werden.");
  }
  const faces: Face[] = [], bounds = new Box3(), vertex = new Vector3();
  const dispose = () => { faces.length = 0; canvas.width = 1; canvas.height = 1; };
  const push = (id: string, positions: ArrayLike<number>, matrix: Matrix4, code: string) => {
    if (faces.length + positions.length / 9 > MAX_TRIANGLES) {
      dispose();
      throw new Error("PDF: WebGL ist nicht verfügbar und dieses Modell ist für die vollständige Software-Abbildung zu groß. Bitte auf einem Gerät mit WebGL exportieren.");
    }
    const color = resolveColor(code);
    for (let start = 0; start < positions.length; start += 9) {
      const points = new Float32Array(9);
      for (let offset = 0; offset < 9; offset += 3) {
        vertex.fromArray(positions, start + offset).applyMatrix4(matrix);
        bounds.expandByPoint(vertex); vertex.toArray(points, offset);
      }
      faces.push({ id, points, color: color?.hex ?? "#ff00ff", alpha: (color?.alpha ?? 255) / 255 });
    }
  };
  for (const [index, part] of (document.imported?.instances ?? []).entries()) {
    signal?.throwIfAborted();
    if (part.part.status !== "resolved") continue;
    const matrix = worldMatrix(part.matrix);
    for (const surface of compilePart(document.imported!, part.reference, "16")) {
      push(part.id, surface.positions, matrix, surface.colorCode === "16" ? part.colorCode : surface.colorCode);
    }
    if (index % 12 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  const addGeometry = (id: string, geometry: BufferGeometry, matrix: Matrix4, color: string) => {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    try {
      push(id, flat.getAttribute("position").array, matrix, `0x2${color.slice(1)}`);
    } finally {
      if (flat !== geometry) flat.dispose();
      geometry.dispose();
    }
  };
  for (const part of document.bricks) {
    signal?.throwIfAborted();
    addGeometry(part.id, createLocalBrickGeometry(part.type), brickTransformMatrix(part), part.color);
  }
  const center = bounds.isEmpty() ? new Vector3() : bounds.getCenter(new Vector3());
  const radius = bounds.isEmpty() ? 2 : Math.max(size.minRadius ?? 1, bounds.getSize(new Vector3()).length() / 2);
  const camera = new OrthographicCamera(-radius * 1.12 * aspect, radius * 1.12 * aspect,
    radius * 1.12, -radius * 1.12, 0.01, Math.max(100, radius * 12));
  camera.position.set(1.1, 0.85, 1.3).normalize().multiplyScalar(radius * 4);
  camera.lookAt(0, 0, 0); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), normal = new Vector3();
  const light = new Vector3(0.4, 0.8, 0.5).normalize(), color = new Color();
  const highlightOccurrences = instructionHighlightOccurrences(document.bricks, document.imported);
  return {
    image(visible, step, highlightIds) {
      signal?.throwIfAborted();
      applyPdfStepCamera(camera, radius, step.camera);
      const rotation = new Matrix4().makeRotationFromEuler(new Euler(
        ...(step.rotation ?? [0, 0, 0]).map(angle => angle * Math.PI / 180) as [number, number, number],
      ));
      const projected: { points: number[]; depth: number; color: string; alpha: number }[] = [];
      const outlines = new Map<string, Box3>();
      for (const face of faces) {
        if (!visible.has(face.id)) continue;
        a.fromArray(face.points, 0).sub(center).applyMatrix4(rotation);
        b.fromArray(face.points, 3).sub(center).applyMatrix4(rotation);
        c.fromArray(face.points, 6).sub(center).applyMatrix4(rotation);
        if (highlightIds?.has(face.id)) {
          let box = outlines.get(face.id);
          if (!box) { box = new Box3(); outlines.set(face.id, box); }
          box.expandByPoint(a); box.expandByPoint(b); box.expandByPoint(c);
        }
        normal.copy(b).sub(a).cross(vertex.copy(c).sub(a)).normalize();
        const shade = 0.58 + 0.42 * Math.abs(normal.dot(light));
        color.set(face.color);
        if (highlightIds !== undefined) instructionDisplayColor(color, highlightIds.has(face.id));
        a.project(camera); b.project(camera); c.project(camera);
        projected.push({
          points: [(a.x + 1) * width / 2, (1 - a.y) * height / 2, (b.x + 1) * width / 2, (1 - b.y) * height / 2, (c.x + 1) * width / 2, (1 - c.y) * height / 2],
          depth: (a.z + b.z + c.z) / 3,
          color: color.multiplyScalar(shade).getStyle(), alpha: face.alpha,
        });
      }
      projected.sort((left, right) => right.depth - left.depth);
      context.fillStyle = "#ffffff"; context.globalAlpha = 1; context.fillRect(0, 0, width, height);
      for (const face of projected) {
        context.globalAlpha = face.alpha; context.fillStyle = face.color; context.beginPath();
        context.moveTo(face.points[0], face.points[1]); context.lineTo(face.points[2], face.points[3]);
        context.lineTo(face.points[4], face.points[5]); context.closePath(); context.fill();
      }
      context.globalAlpha = 1;
      if (outlines.size) {
        const groups = groupInstructionHighlights(highlightOccurrences, new Set(outlines.keys()));
        drawInstructionOutlines(context, camera, instructionGroupBounds(groups, outlines), width, height);
      }
      return canvas.toDataURL("image/jpeg", 0.84);
    },
    dispose,
  };
}
