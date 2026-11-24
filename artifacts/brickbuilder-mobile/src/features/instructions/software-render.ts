import { Box3, Color, Euler, Matrix3, Matrix4, OrthographicCamera, Vector3 } from "three";
import type { BrickType, BuilderDocument } from "../editor/model";
import { brickTransformMatrix } from "../editor/brick-transform";
import { createLocalBrickGeometry, localBrickEdgeNormalPairs, localBrickEdges } from "../engine/local-brick-geometry";
import { compilePart, visibleEdgeData, worldMatrix } from "../engine/ldraw-geometry";
import { instructionDisplayColor } from "./highlight-color";
import { resolveColor } from "../formats/colors";
import type { InstructionImageRenderer } from "./render";
import { drawInstructionOutlines, groupInstructionHighlights, instructionHighlightOccurrences, instructionGroupFrames } from "./outlines";
import { applyPdfStepCamera, fitStudioCamera, setPdfDefaultCamera, studioRenderSize } from "./camera";
import { NORMAL_EDGE_CONTRAST } from "../engine/wide-lines";
import { drawStudioModelArrows, studioModelArrowPoints, type StudioModelArrow } from "./studio-objects";

const MAX_TRIANGLES = 120_000;
const MAX_EDGE_SEGMENTS = 60_000;
export const INSTRUCTION_RENDER_SIZE = { width: 2000, height: 1520 } as const;
interface Face { id: string; points: Float32Array; color: string; alpha: number }
interface EdgeSource {
  id: string;
  positions: Float32Array;
  normals: Float32Array;
  alternateNormals: Float32Array;
  colorCodes?: string[];
  inheritedColor: string;
  matrix: Matrix4;
  normalMatrix: Matrix3;
  firstSegment: number;
}

/**
 * Exact source triangles, not the interactive renderer's sampled fallback.
 * Refuse the export above a bounded CPU budget instead of omitting surfaces.
 */
export async function createSoftwareInstructionRenderer(document: BuilderDocument, signal?: AbortSignal,
  size: { width: number; height: number; minRadius?: number } = { ...INSTRUCTION_RENDER_SIZE, minRadius: 1 }): Promise<InstructionImageRenderer> {
  const canvas = globalThis.document.createElement("canvas");
  canvas.width = size.width; canvas.height = size.height;
  let width = canvas.width, height = canvas.height;
  const aspect = width / height;
  const context = canvas.getContext("2d");
  if (!context) {
    canvas.width = 1; canvas.height = 1;
    throw new Error("PDF-Abbildungen sind nicht verfügbar: Weder WebGL noch die 2D-Ausgabe konnten gestartet werden.");
  }
  const faces: Face[] = [], edgeSources: EdgeSource[] = [], bounds = new Box3(), vertex = new Vector3();
  let sourceEdgeSegments = 0;
  const dispose = () => { faces.length = 0; edgeSources.length = 0; canvas.width = 1; canvas.height = 1; };
  const push = (id: string, positions: ArrayLike<number>, matrix: Matrix4, code: string) => {
    if (faces.length + positions.length / 9 > MAX_TRIANGLES) {
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
  try {
    for (const [index, part] of (document.imported?.instances ?? []).entries()) {
      signal?.throwIfAborted();
      if (part.part.status !== "resolved") continue;
      const matrix = worldMatrix(part.matrix);
      const surfaces = compilePart(document.imported!, part.reference, "16");
      for (const surface of surfaces) {
        push(part.id, surface.positions, matrix, surface.colorCode === "16" ? part.colorCode : surface.colorCode);
      }
      const edgeData = visibleEdgeData(surfaces);
      if (edgeData.positions.length) {
        edgeSources.push({
          id: part.id, ...edgeData, inheritedColor: part.colorCode, matrix,
          normalMatrix: new Matrix3().getNormalMatrix(matrix), firstSegment: sourceEdgeSegments,
        });
        sourceEdgeSegments += edgeData.positions.length / 6;
      }
      if (index % 12 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    // Retain only read-only triangle arrays during preparation, not GPU resources.
    const localTriangles = new Map<BrickType, ArrayLike<number>>();
    for (const part of document.bricks) {
      signal?.throwIfAborted();
      let positions = localTriangles.get(part.type);
      if (!positions) {
        const geometry = createLocalBrickGeometry(part.type);
        try {
          const flat = geometry.index ? geometry.toNonIndexed() : geometry;
          try {
            positions = flat.getAttribute("position").array;
            localTriangles.set(part.type, positions);
          } finally {
            if (flat !== geometry) flat.dispose();
          }
        } finally {
          geometry.dispose();
        }
      }
      const matrix = brickTransformMatrix(part);
      push(part.id, positions, matrix, `0x2${part.color.slice(1)}`);
      const localEdges = localBrickEdges(part.type), pairs = localBrickEdgeNormalPairs(part.type);
      if (localEdges.length) {
        edgeSources.push({
          id: part.id, positions: localEdges, normals: pairs.primary, alternateNormals: pairs.alternate,
          inheritedColor: `0x2${part.color.slice(1)}`, matrix,
          normalMatrix: new Matrix3().getNormalMatrix(matrix), firstSegment: sourceEdgeSegments,
        });
        sourceEdgeSegments += localEdges.length / 6;
      }
    }
    localTriangles.clear();
    signal?.throwIfAborted();
    const center = bounds.isEmpty() ? new Vector3() : bounds.getCenter(new Vector3());
    const radius = bounds.isEmpty() ? 2 : Math.max(size.minRadius ?? 1, bounds.getSize(new Vector3()).length() / 2);
    const camera = new OrthographicCamera(-radius * 1.12 * aspect, radius * 1.12 * aspect,
      radius * 1.12, -radius * 1.12, 0.01, Math.max(100, radius * 12));
    setPdfDefaultCamera(camera, radius);
    const a = new Vector3(), b = new Vector3(), c = new Vector3(), normal = new Vector3();
    const light = new Vector3(0.4, 0.8, 0.5).normalize(), color = new Color();
    const edgeStride = Math.max(1, Math.ceil(sourceEdgeSegments / MAX_EDGE_SEGMENTS));
    const rotationNormal = new Matrix3();
    const highlightOccurrences = instructionHighlightOccurrences(document.bricks, document.imported);
    return {
      image(visible, step, highlightIds, fitAspect, modelArrows = []) {
        signal?.throwIfAborted();
        const renderSize = fitAspect ? studioRenderSize(fitAspect) : size;
        width = renderSize.width; height = renderSize.height;
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width; canvas.height = height;
        }
        camera.left = -radius * 1.12 * aspect; camera.right = -camera.left;
        camera.top = radius * 1.12; camera.bottom = -camera.top;
        applyPdfStepCamera(camera, radius, step.camera);
        const rotation = new Matrix4().makeRotationFromEuler(new Euler(
          ...(step.rotation ?? [0, 0, 0]).map(angle => angle * Math.PI / 180) as [number, number, number],
        ));
        if (fitAspect) {
          const fitBounds = new Box3();
          for (const face of faces) {
            if (!visible.has(face.id)) continue;
            for (let offset = 0; offset < 9; offset += 3) {
              fitBounds.expandByPoint(vertex.fromArray(face.points, offset).sub(center)
                .applyMatrix4(rotation).applyMatrix4(camera.matrixWorldInverse));
            }
          }
          for (const arrowPoint of studioModelArrowPoints(
            modelArrows, center, step.rotation ?? [0, 0, 0],
          )) fitBounds.expandByPoint(arrowPoint.applyMatrix4(camera.matrixWorldInverse));
          fitStudioCamera(camera, fitBounds, width / height);
        }
        const projected: { points: number[]; depth: number; color: string; alpha: number }[] = [];
        const highlighted = new Set<string>();
        for (const face of faces) {
          if (!visible.has(face.id)) continue;
          a.fromArray(face.points, 0).sub(center).applyMatrix4(rotation);
          b.fromArray(face.points, 3).sub(center).applyMatrix4(rotation);
          c.fromArray(face.points, 6).sub(center).applyMatrix4(rotation);
          if (highlightIds?.has(face.id)) {
            highlighted.add(face.id);
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
        rotationNormal.setFromMatrix4(rotation);
        const lineStrokes = new Map<string, number[]>();
        const firstPoint = new Vector3(), secondPoint = new Vector3();
        const firstNormal = new Vector3(), secondNormal = new Vector3();
        const midpoint = new Vector3(), viewDirection = new Vector3();
        for (const source of edgeSources) {
          if (!visible.has(source.id)) continue;
          const segmentCount = source.positions.length / 6;
          for (let segment = 0; segment < segmentCount; segment++) {
            if ((source.firstSegment + segment) % edgeStride !== 0) continue;
            const offset = segment * 6;
            firstPoint.fromArray(source.positions, offset).applyMatrix4(source.matrix).sub(center).applyMatrix4(rotation);
            secondPoint.fromArray(source.positions, offset + 3).applyMatrix4(source.matrix).sub(center).applyMatrix4(rotation);
            firstNormal.fromArray(source.normals, offset).applyMatrix3(source.normalMatrix).applyMatrix3(rotationNormal).normalize();
            secondNormal.fromArray(source.alternateNormals, offset).applyMatrix3(source.normalMatrix).applyMatrix3(rotationNormal).normalize();
            midpoint.copy(firstPoint).add(secondPoint).multiplyScalar(0.5);
            viewDirection.copy(camera.position).sub(midpoint).normalize();
            if (Math.max(firstNormal.dot(viewDirection), secondNormal.dot(viewDirection)) < -0.05) continue;
            const first = firstPoint.clone().project(camera), second = secondPoint.clone().project(camera);
            if (first.z < -1 || first.z > 1 || second.z < -1 || second.z > 1) continue;
            const sourceColor = source.colorCodes?.[segment];
            color.set(resolveColor(sourceColor && sourceColor !== "16" ? sourceColor : source.inheritedColor)?.hex ?? "#ff00ff");
            if (highlightIds !== undefined) instructionDisplayColor(color, highlightIds.has(source.id));
            const stroke = color.clone().multiplyScalar(
              (0.58 + 0.42 * Math.abs(firstNormal.dot(light))) * NORMAL_EDGE_CONTRAST,
            ).getStyle();
            const points = lineStrokes.get(stroke) ?? [];
            points.push(
              (first.x + 1) * width / 2, (1 - first.y) * height / 2,
              (second.x + 1) * width / 2, (1 - second.y) * height / 2,
            );
            lineStrokes.set(stroke, points);
          }
        }
        context.lineWidth = Math.max(1, width / 1000);
        for (const [stroke, points] of lineStrokes) {
          context.beginPath();
          for (let index = 0; index + 3 < points.length; index += 4) {
            context.moveTo(points[index], points[index + 1]);
            context.lineTo(points[index + 2], points[index + 3]);
          }
          context.strokeStyle = stroke;
          context.stroke();
        }
        if (modelArrows.length) {
          drawStudioModelArrows(context, camera, modelArrows, center, step.rotation ?? [0, 0, 0], width, height);
        }
        if (highlighted.size) {
          const groups = groupInstructionHighlights(highlightOccurrences, highlighted);
          const diagram = rotation.clone().multiply(new Matrix4().makeTranslation(-center.x, -center.y, -center.z));
          drawInstructionOutlines(context, camera, instructionGroupFrames(groups, highlightOccurrences, diagram), width, height);
        }
        return canvas.toDataURL("image/png");
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
