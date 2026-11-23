import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { renderView, ViewExportError, type ViewExporter } from "./view-export";
import { Link2, TriangleAlert, Cloud, MousePointer2, Layers } from "lucide-react";
import { collisionWarningsInWorker, type CollisionProgress } from "./collision-warning";
import {
  BoxGeometry,
  Box3,
  Box3Helper,
  BufferGeometry,
  Color,
  EdgesGeometry,
  Group,
  InstancedMesh,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LineBasicMaterial,
  LineSegments,
  Material,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene,
  SRGBColorSpace,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { createLocalBrickGeometry, localBrickEdges, localBrickShape, localBrickTriangles } from "./local-brick-geometry";
import {
  applyInstructionCameraRotation,
  DEFAULT_INSTRUCTION_PHI,
  DEFAULT_INSTRUCTION_THETA,
  instructionRotationFromCameraPose,
} from "./instruction-camera";
import { applyInstructionFocus, installInstructionFocus, instructionDisplayColor } from "./instruction-focus";
import { createImportedGroup, createImportedGroupAsync, disposeImportedScene, SceneBudgetExceeded } from "./imported-scene";
import { prepareGeometry } from "./prepare-geometry";
import { compilePart, reuseGeometryCache, worldMatrix } from "./ldraw-geometry";
import { importedSelectionBounds, pickSoftwareInstance } from "./imported-selection";
import { createSoftwareScene, updateSoftwareScene, previewSoftware, restoreSoftware, applySoftwareInstructionFocus, INTERACTIVE_TRIANGLE_BUDGET, type SoftwareScene } from "./software-scene";
import { InstanceIndex, instanceIndex } from "./instance-index";
import {
  activeConnections, magneticConstructionTransform, hasUsableConnections,
} from "../connections/engine";
import { connectedPartsAbove } from "../connections/connected-move";
import type { MagneticLatch } from "../connections/engine";
import { placementSnapModel, PLACEMENT_SNAP_ID } from "./placement-snapping";
import { ConnectionOverlay } from "../connections/overlay";
import type { InstructionCamera } from "../instructions/types";
import { drawInstructionOutlines, groupInstructionHighlights, instructionHighlightOccurrences, instructionGroupBounds } from "../instructions/outlines";
import { floatingParts, legacyBrickBounds } from "./floating";
import { stackingBounds } from "./stacking";
import type { ConnectionTransform } from "../connections/types";
import { createBuilderLighting } from "./lighting";
import type { Affine, ImportedModel } from "../formats/types";
import { cameraGesture, type GestureStart, type PointerPoint } from "./camera-gesture";
import { appearanceCode, type PreparedPart } from "../editor/ldraw-editing";
import { resolveColor } from "../formats/colors";
import { expandWideLines, setWideLineResolution, THICK_EDGE_WIDTH_PX, wideLineMaterial } from "./wide-lines";

import {
  BRICK_DEFINITIONS,
  BRICK_HEIGHT,
  snapPosition,
  type Brick,
  type BrickType,
  type Position3,
  type ToolMode,
} from "@/features/editor/model";
import { brickTransformMatrix } from "@/features/editor/brick-transform";
import { brickConstructionBounds, constructionArea, createStudGridGeometry, type ConstructionArea } from "./construction-floor";
import { useI18n } from "@/i18n/I18nProvider";
import type { MessageId } from "@/i18n/messages";
import {
  BUILD_SINGLE_TAP_DELAY_MS,
  DOUBLE_TAP_INTERVAL_MS,
  EMPTY_DOUBLE_TAP_ZOOM_FACTOR,
  EMPTY_DOUBLE_TAP_ZOOM_MODES,
} from "./gesture-guide";

interface BuilderCanvasProps {
  viewExporterRef?: MutableRefObject<ViewExporter | null>;
  showConstructionControls?: boolean;
  emptyDoubleTapZoomEnabled?: boolean;
  darkMode?: boolean;
  /** Screen-space edge stroke; false preserves the original one-pixel view. */
  thickEdges?: boolean;
  /** Presentation only: never changes project part transforms. */
  viewRotation?: readonly [number, number, number];
  viewCamera?: InstructionCamera;
  viewStepId?: string;
  onViewCameraChange?: (camera: InstructionCamera, rotation?: [number, number, number]) => void;
  /** Occurrence IDs for the current instruction step; undefined restores normal colors. */
  instructionFocusIds?: ReadonlySet<string>;
  projectId?: string;
  bricks: Brick[];
  imported?: ImportedModel;
  selectedId: string | null;
  selectedIds?: readonly string[];
  /** Temporary display-only local LDU position for the selected imported part. */
  selectedRotationAnchor?: [number, number, number] | null;
  selectedType: BrickType;
  selectedColor: string;
  selectedColorCode?: string;
  placementPreview?: PreparedPart | null;
  toolMode: ToolMode;
  onPlace: (position: Position3, transform?: Affine, options?: { stayInBuildMode?: boolean; floorSnap?: boolean }) => void;
  onSelect: (id: string | null) => void;
  onViewPartTap?: (id: string) => void;
  onOpenRotationControls?: (id: string) => void;
  onMove: (id: string, position: Position3, transform?: Affine) => void;
  onMoveGroup?: (ids: readonly string[], delta: Position3) => void;
}

interface DragMember {
  id: string;
  brick?: Brick;
  matrix?: Affine;
}

interface DragCandidate {
  id: string;
  pointerId: number;
  start: PointerPoint;
  origin: Position3;
  moved: boolean;
  destination: Position3 | null;
  needsSnap?: boolean;
  matrix?: Affine;
  connection?: ConnectionTransform;
  magneticLatch?: MagneticLatch;
  planeStart: Position3 | null;
  members: DragMember[];
}

interface BrickHit {
  id: string;
  point: Vector3;
}

interface ProjectedPoint {
  x: number;
  y: number;
  depth: number;
}

interface PlacementPreviewGeometry {
  surfaces: ReturnType<typeof compilePart>;
  matrix: Affine;
  colorCode: string;
}

const PLACEMENT_PREVIEW_ID = "placement-preview";

export class FallbackRenderer {
  readonly domElement = document.createElement("canvas");
  private readonly context = this.domElement.getContext("2d");
  private pixelRatio = Math.min(window.devicePixelRatio || 1, 1.25);
  private width = 1;
  private height = 1;

  constructor() {
    if (!this.context) throw new Error("2D canvas fallback is unavailable.");
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.domElement.width = Math.max(1, Math.round(width * this.pixelRatio));
    this.domElement.height = Math.max(1, Math.round(height * this.pixelRatio));
    this.domElement.style.width = `${width}px`;
    this.domElement.style.height = `${height}px`;
  }

  render(
    camera: PerspectiveCamera,
    target: Vector3,
    bricks: Brick[],
    selectedId: string | null,
    imported?: SoftwareScene,
    importOffset = 0,
    interactive = false,
    instructionFocusIds?: ReadonlySet<string>,
    floor: ConstructionArea = constructionArea(new Box3()),
    darkMode = false,
    placementGeometry?: PlacementPreviewGeometry | null,
    placementBrick?: Brick | null,
    thickEdges = false,
  ): void {
    const context = this.context;
    if (!context) return;
    camera.updateMatrixWorld(true);
    const forward = target.clone().sub(camera.position).normalize();
    const right = new Vector3().crossVectors(forward, camera.up).normalize();
    const up = new Vector3().crossVectors(right, forward).normalize();
    const focalLength = (this.height / 2) / Math.tan((camera.fov * Math.PI) / 360);
    context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    context.clearRect(0, 0, this.width, this.height);
    context.fillStyle = darkMode ? "#111a18" : "#eef1ec";
    context.fillRect(0, 0, this.width, this.height);

    const project = (x: number, y: number, z: number): ProjectedPoint => {
      const relative = new Vector3(x, y, z).sub(camera.position);
      const depth = relative.dot(forward);
      return {
        x: this.width / 2 + (relative.dot(right) * focalLength) / depth,
        y: this.height / 2 - (relative.dot(up) * focalLength) / depth,
        depth,
      };
    };

    const board = [
      project(floor.minX, -0.025, floor.minZ),
      project(floor.maxX, -0.025, floor.minZ),
      project(floor.maxX, -0.025, floor.maxZ),
      project(floor.minX, -0.025, floor.maxZ),
    ];
    fillPolygon(context, board, darkMode ? "#1d2b26" : "#e1e6df", darkMode ? "#31483f" : "#d2d9d1");
    context.save();
    polygonPath(context, board);
    context.clip();
    context.lineWidth = 0.7;
    context.strokeStyle = darkMode ? "rgba(144, 177, 157, 0.38)" : "rgba(118, 139, 126, 0.35)";
    const firstX = Math.ceil(floor.minX / floor.gridStride) * floor.gridStride;
    const lastX = Math.floor(floor.maxX / floor.gridStride) * floor.gridStride;
    const firstZ = Math.ceil(floor.minZ / floor.gridStride) * floor.gridStride;
    const lastZ = Math.floor(floor.maxZ / floor.gridStride) * floor.gridStride;
    const coordinates: { axis: "x" | "z"; value: number }[] = [];
    for (let coordinate = firstX; coordinate <= lastX; coordinate += floor.gridStride) coordinates.push({ axis: "x", value: coordinate });
    for (let coordinate = firstZ; coordinate <= lastZ; coordinate += floor.gridStride) coordinates.push({ axis: "z", value: coordinate });
    for (const { axis, value: coordinate } of coordinates) {
      const isMajorLine = Math.abs(coordinate % 5) < 0.001;
      context.lineWidth = isMajorLine ? 0.7 : 0.45;
      context.strokeStyle = darkMode
        ? isMajorLine ? "rgba(144, 177, 157, 0.42)" : "rgba(144, 177, 157, 0.22)"
        : isMajorLine ? "rgba(118, 139, 126, 0.35)" : "rgba(118, 139, 126, 0.17)";
      const line = axis === "x"
        ? [project(coordinate, -0.018, floor.minZ), project(coordinate, -0.018, floor.maxZ)]
        : [project(floor.minX, -0.018, coordinate), project(floor.maxX, -0.018, coordinate)];
      context.beginPath();
      context.moveTo(line[0].x, line[0].y);
      context.lineTo(line[1].x, line[1].y);
      context.stroke();
    }
    context.restore();

    // Bounded, pretransformed source triangles; never traverse the full model
    // or allocate millions of world-space vectors for a camera movement.
    const importedFaces: { points: ProjectedPoint[]; depth: number; color: string; alpha: number; opacity: number; selected: boolean }[] = [];
    if (imported) {
      const stride = interactive ? Math.max(1, Math.ceil(imported.triangleCount / INTERACTIVE_TRIANGLE_BUDGET)) : 1;
      for (let triangle = 0; triangle < imported.triangleCount; triangle += stride) {
            if (imported.alpha[triangle] === 0) continue;
            const index = triangle * 9, vertices = imported.positions;
            const points = [0, 3, 6].map(offset => project(vertices[index + offset], vertices[index + offset + 1] + importOffset, vertices[index + offset + 2]));
            if (points.some(p => p.depth < 0.1)) continue;
            const area = (points[1].x - points[0].x) * (points[2].y - points[0].y) - (points[1].y - points[0].y) * (points[2].x - points[0].x);
            if (Math.abs(area) < 0.08) continue;
            const id = imported.triangleIds[triangle];
            const color = imported.instructionColors?.[triangle] ?? imported.colors[triangle];
            importedFaces.push({ points, depth: points.reduce((s, p) => s + p.depth, 0) / 3, color, alpha: imported.alpha[triangle], opacity: 1, selected: id === selectedId });
      }
    }
    if (placementGeometry) {
      const transform = worldMatrix(placementGeometry.matrix);
      const a = new Vector3(), b = new Vector3(), c = new Vector3(), normal = new Vector3();
      const light = new Vector3(0.4, 0.8, 0.5).normalize();
      for (const surface of placementGeometry.surfaces) {
        const mapping = resolveColor(surface.colorCode === "16" ? placementGeometry.colorCode : surface.colorCode);
        const base = new Color(mapping?.hex ?? "#ff00ff");
        const alpha = (mapping?.alpha ?? 255) / 255 * 0.72;
        for (let index = 0; index < surface.positions.length; index += 9) {
          a.fromArray(surface.positions, index).applyMatrix4(transform);
          b.fromArray(surface.positions, index + 3).applyMatrix4(transform);
          c.fromArray(surface.positions, index + 6).applyMatrix4(transform);
          const points = [project(a.x, a.y, a.z), project(b.x, b.y, b.z), project(c.x, c.y, c.z)];
          if (points.some(point => point.depth < 0.1)) continue;
          const area = (points[1].x - points[0].x) * (points[2].y - points[0].y) -
            (points[1].y - points[0].y) * (points[2].x - points[0].x);
          if (Math.abs(area) < 0.08) continue;
          normal.copy(b).sub(a).cross(c.clone().sub(a)).normalize();
          importedFaces.push({
            points, depth: points.reduce((sum, point) => sum + point.depth, 0) / 3,
            color: base.clone().multiplyScalar(0.58 + 0.42 * Math.abs(normal.dot(light))).getStyle(),
            alpha, opacity: 1, selected: false,
          });
        }
      }
    }
    if (importedFaces.length) {
      importedFaces.sort((a, b) => b.depth - a.depth);
      for (const face of importedFaces) {
        polygonPath(context, face.points);
        context.globalAlpha = face.alpha * face.opacity;
        context.fillStyle = face.color;
        context.fill();
        if (face.selected) {
          context.globalAlpha = 1;
          context.strokeStyle = "#e45e32"; context.lineWidth = 1.5; context.stroke();
        }
      }
      context.globalAlpha = 1;
    }

    let remainingEdgeSegments = 12_000;
    if (thickEdges) {
      context.beginPath();
      context.strokeStyle = darkMode ? "rgba(205, 220, 211, 0.72)" : "rgba(15, 20, 16, 0.76)";
      context.lineWidth = THICK_EDGE_WIDTH_PX;
      const drawSegments = (positions: Float32Array, transform: import("three").Matrix4, yOffset = 0) => {
        const a = new Vector3(), b = new Vector3();
        for (let index = 0; index + 5 < positions.length && remainingEdgeSegments > 0; index += 6) {
          remainingEdgeSegments--;
          a.fromArray(positions, index).applyMatrix4(transform);
          b.fromArray(positions, index + 3).applyMatrix4(transform);
          const first = project(a.x, a.y + yOffset, a.z);
          const second = project(b.x, b.y + yOffset, b.z);
          if (first.depth < 0.1 || second.depth < 0.1) continue;
          context.moveTo(first.x, first.y); context.lineTo(second.x, second.y);
        }
      };
      if (imported) {
        for (const record of imported.edgeRecords) {
          if (remainingEdgeSegments <= 0) break;
          if (record.localEdges.length) drawSegments(record.localEdges, worldMatrix(record.currentMatrix), importOffset);
        }
      }
      if (placementGeometry) {
        const transform = worldMatrix(placementGeometry.matrix);
        for (const surface of placementGeometry.surfaces) {
          if (remainingEdgeSegments <= 0) break;
          drawSegments(surface.edges, transform);
        }
      }
      context.stroke();
    }

    const orderedBricks = [...bricks, ...(placementBrick ? [placementBrick] : [])].sort(
      (first, second) =>
        camera.position.distanceTo(new Vector3(second.x, second.y, second.z)) -
        camera.position.distanceTo(new Vector3(first.x, first.y, first.z)),
    );
    let visibleBricks = 0;
    for (const brick of orderedBricks) {
      const center = project(brick.x, brick.y, brick.z);
      if (center.depth < 0.1 || center.x < -96 || center.x > this.width + 96 || center.y < -96 || center.y > this.height + 96) continue;
      if (visibleBricks++ >= (interactive ? 300 : 1200) && brick.id !== selectedId) continue;
      const definition = BRICK_DEFINITIONS[brick.type];
      const transform = brickTransformMatrix(brick);
      const color = new Color(brick.color);
      if (instructionFocusIds !== undefined) instructionDisplayColor(color, instructionFocusIds.has(brick.id));
      // Project the same body and cylindrical studs as WebGL/PDF. Screen-space
      // ellipses cannot represent a stud correctly when its brick is tilted.
      const triangles = localBrickTriangles(brick.type);
      const faces: { points: ProjectedPoint[]; depth: number; shade: number; opacity: number }[] = [];
      const light = new Vector3(0.4, 0.8, 0.5).normalize();
      for (let index = 0; index < triangles.length; index += 9) {
        const world = [0, 3, 6].map(offset =>
          new Vector3().fromArray(triangles, index + offset).applyMatrix4(transform));
        const normal = world[1].clone().sub(world[0]).cross(world[2].clone().sub(world[0])).normalize();
        if (normal.dot(camera.position.clone().sub(world[0])) <= 0) continue;
        const points = world.map(point => project(point.x, point.y, point.z));
        if (points.some(point => point.depth < 0.1)) continue;
        faces.push({
          points,
          depth: points.reduce((sum, point) => sum + point.depth, 0) / 3,
          shade: 0.58 + 0.42 * Math.abs(normal.dot(light)),
          opacity: brick.id === "placement-preview-brick" ? 0.72 : 1,
        });
      }
      faces.sort((first, second) => second.depth - first.depth);
      for (const face of faces) {
        polygonPath(context, face.points);
        context.fillStyle = color.clone().multiplyScalar(face.shade).getStyle();
        context.globalAlpha = face.opacity;
        context.fill();
      }
      context.globalAlpha = 1;

      if (thickEdges && remainingEdgeSegments > 0) {
        const edges = localBrickEdges(brick.type);
        context.beginPath();
        context.strokeStyle = darkMode ? "rgba(205, 220, 211, 0.72)" : "rgba(15, 20, 16, 0.76)";
        context.lineWidth = THICK_EDGE_WIDTH_PX;
        const point = new Vector3();
        for (let index = 0; index + 5 < edges.length && remainingEdgeSegments > 0; index += 6) {
          remainingEdgeSegments--;
          const a = point.fromArray(edges, index).applyMatrix4(transform);
          const first = project(a.x, a.y, a.z);
          const b = point.fromArray(edges, index + 3).applyMatrix4(transform);
          const second = project(b.x, b.y, b.z);
          if (first.depth < 0.1 || second.depth < 0.1) continue;
          context.moveTo(first.x, first.y); context.lineTo(second.x, second.y);
        }
        context.stroke();
      }

      if (selectedId === brick.id) {
        const selectionTop = [
          [-definition.studsX / 2, -definition.studsZ / 2],
          [definition.studsX / 2, -definition.studsZ / 2],
          [definition.studsX / 2, definition.studsZ / 2],
          [-definition.studsX / 2, definition.studsZ / 2],
        ].map(([x, z]) => {
          const shape = localBrickShape(brick.type);
          const point = new Vector3(x, shape.bodyHeight + shape.studHeight, z).applyMatrix4(transform);
          return project(point.x, point.y, point.z);
        });
        polygonPath(context, selectionTop);
        context.strokeStyle = "#b84e37";
        context.lineWidth = 2;
        context.setLineDash([4, 3]);
        context.stroke();
        context.setLineDash([]);
      }
    }
  }
}

const geometryCache = new Map<BrickType, BufferGeometry>();
const VIEW_TAP_MAX_DURATION_MS = 400;
const PART_TAP_ACTION_DELAY_MS = 520;

function polygonPath(context: CanvasRenderingContext2D, points: ProjectedPoint[]): void {
  if (!points.length) return;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.closePath();
}

function fillPolygon(
  context: CanvasRenderingContext2D,
  points: ProjectedPoint[],
  fill: string,
  stroke: string,
): void {
  polygonPath(context, points);
  context.fillStyle = fill;
  context.fill();
  context.strokeStyle = stroke;
  context.lineWidth = 0.85;
  context.stroke();
}

function brickGeometry(type: BrickType) {
  const cached = geometryCache.get(type);
  if (cached) return cached;

  const merged = createLocalBrickGeometry(type);
  geometryCache.set(type, merged);
  return merged;
}

function makeCameraPosition(
  camera: PerspectiveCamera,
  target: Vector3,
  theta: number,
  phi: number,
  distance: number,
) {
  camera.position.set(
    target.x + distance * Math.sin(phi) * Math.sin(theta),
    target.y + distance * Math.cos(phi),
    target.z + distance * Math.sin(phi) * Math.cos(theta),
  );
  camera.lookAt(target);
}

function fitImportedView(
  camera: PerspectiveCamera,
  bounds: Box3,
  state: { target: Vector3; distance: number; theta: number; phi: number },
): void {
  if (bounds.isEmpty()) return;
  bounds.getCenter(state.target);
  // Fit the bounding sphere against the narrower field of view, including portrait.
  const halfVertical = camera.fov * Math.PI / 360;
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * camera.aspect);
  const radius = bounds.getSize(new Vector3()).length() / 2;
  state.distance = Math.max(8, radius / Math.sin(Math.min(halfVertical, halfHorizontal)) * 1.08);
  camera.far = Math.max(2000, (state.distance + radius) * 8);
  camera.updateProjectionMatrix();
  makeCameraPosition(camera, state.target, state.theta, state.phi, state.distance);
}

function softwareWarning(scene: SoftwareScene, locale: "en" | "de", t: ReturnType<typeof useI18n>["t"]): string {
  const samples = scene.triangleCount - scene.free.length;
  return t("canvas.compatibility", {
    shown: samples.toLocaleString(locale === "de" ? "de-DE" : "en-US"),
    total: scene.sourceTriangles.toLocaleString(locale === "de" ? "de-DE" : "en-US"),
  });
}

export function BuilderCanvas({
  viewExporterRef,
  showConstructionControls = true,
  emptyDoubleTapZoomEnabled = true,
  darkMode = false,
  viewRotation,
  viewCamera,
  viewStepId,
  onViewCameraChange,
  instructionFocusIds,
  projectId,
  bricks,
  imported,
  selectedId,
  selectedIds,
  selectedRotationAnchor = null,
  selectedType,
  selectedColor,
  selectedColorCode,
  placementPreview,
  thickEdges = false,
  toolMode,
  onPlace,
  onSelect,
  onViewPartTap,
  onOpenRotationControls,
  onMove,
  onMoveGroup,
}: BuilderCanvasProps) {
  const { locale, t } = useI18n();
  const localeRef = useRef(locale);
  const translateRef = useRef(t);
  localeRef.current = locale;
  translateRef.current = t;
  const hostRef = useRef<HTMLDivElement>(null);
  const rotationAnchorMarkerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const cameraRef = useRef<PerspectiveCamera | null>(null);
  const rendererRef = useRef<WebGLRenderer | FallbackRenderer | null>(null);
  const brickRootRef = useRef<Group | null>(null);
  const importedRootRef = useRef<Group | null>(null);
  const placementRootRef = useRef<Group | Mesh | null>(null);
  const placementIndexRef = useRef<InstanceIndex | null>(null);
  const placementPreviewGeometryRef = useRef<PlacementPreviewGeometry | null>(null);
  const placementPreviewBrickRef = useRef<Brick | null>(null);
  const placementContextRef = useRef({ projectId, preview: placementPreview });
  const placementTargetRef = useRef<Position3 | null>(null);
  const placementMatrixRef = useRef<Affine | null>(null);
  const stalePlacementPreviewRef = useRef(false);
  const placementBottomRef = useRef(0);
  const placementSourceMatrixRef = useRef<Affine | null>(null);
  const sceneModelRef = useRef<ImportedModel | undefined>(undefined);
  const sceneProjectRef = useRef<string | undefined>(undefined);
  const selectionOutlineRef = useRef<Box3Helper | null>(null);
  const importedBoundsRef = useRef<Box3 | null>(null);
  const constructionAreaRef = useRef<ConstructionArea>(constructionArea(new Box3()));
  const constructionBoundsRef = useRef(new Box3());
  const refreshConstructionAreaRef = useRef<((candidate?: Box3) => void) | null>(null);
  const softwareSceneRef = useRef<SoftwareScene | undefined>(undefined);
  const importedOffsetRef = useRef(0);
  const instructionOutlineCacheRef = useRef<{
    bricks: Brick[]; imported?: ImportedModel; focus: ReadonlySet<string>; offset: number; boxes: Box3[];
  } | null>(null);
  const interactionTimeRef = useRef(-Infinity);
  const buildControllerRef = useRef<AbortController | null>(null);
  const [sceneStatus, setSceneStatus] = useState<string | null>(null);
  useEffect(() => {
    previousPartTapRef.current = null;
    const pending = pendingTapActionRef.current;
    if (pending) window.clearTimeout(pending.timer);
    pendingTapActionRef.current = null;
  }, [projectId]);
  useEffect(() => {
    if (pendingTapActionRef.current) {
      window.clearTimeout(pendingTapActionRef.current.timer);
      pendingTapActionRef.current = null;
      previousPartTapRef.current = null;
    }
  }, [toolMode]);
  useEffect(() => {
    if (!viewExporterRef) return;
    const exporter: ViewExporter = async (format, options) => {
      const camera = cameraRef.current;
      if (!camera || softwareSceneRef.current ||
        (propsRef.current.imported && sceneModelRef.current !== propsRef.current.imported)) {
        throw new ViewExportError("unavailable");
      }
      const roots = [brickRootRef.current, importedRootRef.current].filter((root): root is Group => root !== null);
      return renderView(roots, camera, format, options);
    };
    viewExporterRef.current = exporter;
    return () => { if (viewExporterRef.current === exporter) viewExporterRef.current = null; };
  }, [viewExporterRef]);
  const [renderWarning, setRenderWarning] = useState<string | null>(null);
  const [buildAttempt, setBuildAttempt] = useState(0);
  const [forceCompatibility, setForceCompatibility] = useState(false);
  const pendingPreviewRef = useRef<(() => void) | null>(null);
  const rollbackRef = useRef<(() => void) | null>(null);
  const previewBrickRef = useRef<Brick | null>(null);
  const attemptRef = useRef(-1);
  const overlayRef = useRef<ConnectionOverlay | null>(null);
  const [showConnections, setShowConnections] = useState(true);
  const [showCollisions, setShowCollisions] = useState(false);
  const [collisionState, setCollisionState] = useState<{
    count: number; uncertain: boolean; pending: boolean; failed: boolean; progress: CollisionProgress | null;
  }>({ count: 0, uncertain: false, pending: false, failed: false, progress: null });
  const [toggleToast, setToggleToast] = useState("");
  const [autoSelectOnTap, setAutoSelectOnTap] = useState(true);
  const autoSelectOnTapRef = useRef(true);
  autoSelectOnTapRef.current = autoSelectOnTap;
  const [autoSelectAfterPlacement, setAutoSelectAfterPlacement] = useState(false);
  const autoSelectAfterPlacementRef = useRef(false);
  autoSelectAfterPlacementRef.current = autoSelectAfterPlacement;
  const [moveConnectedAbove, setMoveConnectedAbove] = useState(true);
  useEffect(() => {
    if (!toggleToast) return;
    const timer = setTimeout(() => setToggleToast(""), 2200);
    return () => clearTimeout(timer);
  }, [toggleToast]);
  const [connectionStatus, setConnectionStatus] = useState("");
  const [floatingCount, setFloatingCount] = useState(0);
  const [showFloating, setShowFloating] = useState(false);
  const showFloatingRef = useRef(false);
  showFloatingRef.current = showFloating;
  const floatingCacheRef = useRef<{ source: ImportedModel | Brick[]; floor: number; boxes: Map<string, Box3> } | null>(null);
  const refreshFloating = () => {
    const overlay = overlayRef.current, model = propsRef.current.imported;
    if (!overlay) return;
    if (!showFloatingRef.current) {
      overlay.floating = new Map(); setFloatingCount(0);
      invalidatorRef.current?.();
      return;
    }
    if (model && model !== sceneModelRef.current) {
      overlay.floating = new Map(); setFloatingCount(0); return;
    }
    const source = model ?? propsRef.current.bricks, floor = model ? -importedOffsetRef.current : 0;
    let cached = floatingCacheRef.current;
    if (!cached || cached.source !== source || cached.floor !== floor) {
      cached = { source, floor, boxes: floatingParts(model ? stackingBounds(model) : legacyBrickBounds(propsRef.current.bricks), floor) };
      floatingCacheRef.current = cached;
    }
    overlay.floating = cached.boxes;
    setFloatingCount(cached.boxes.size);
    invalidatorRef.current?.();
  };
  const refreshConnections = () => {
    refreshFloating();
    const overlay = overlayRef.current, model = propsRef.current.imported, id = propsRef.current.selectedId;
    if (!overlay) return;
    if (model !== sceneModelRef.current) { overlay.contacts = []; overlay.previews = []; setConnectionStatus(""); return; }
    overlay.contacts = model && id ? activeConnections(model, id) : [];
    overlay.previews = [];
    const instance = model?.instances.find(value => value.id === id);
    setConnectionStatus(overlay.contacts.length ? translateRef.current("canvas.connectionCount", { count: overlay.contacts.length }) :
      instance && model ? hasUsableConnections(model, instance.id) ? translateRef.current("canvas.noConnection") : translateRef.current("canvas.connectionDataUnavailable") : "");
  };
  const updateImportedSelection = () => {
    const old = selectionOutlineRef.current;
    const id = propsRef.current.selectedId, root = importedRootRef.current;
    const bounds = id && root ? importedSelectionBounds(root, id) : null;
    if (old && bounds) { old.box.copy(bounds); invalidatorRef.current?.(); return; }
    if (old) { sceneRef.current?.remove(old); old.geometry.dispose(); disposeMaterial(old.material); selectionOutlineRef.current = null; }
    if (id && root) {
      if (bounds) {
        const outline = new Box3Helper(bounds, 0xe45e32);
        for (const material of Array.isArray(outline.material) ? outline.material : [outline.material]) material.depthTest = false;
        outline.renderOrder = 100;
        sceneRef.current?.add(outline); selectionOutlineRef.current = outline;
      }
    }
    invalidatorRef.current?.();
  };
  const invalidatorRef = useRef<(() => void) | null>(null);
  const refreshInstructionFocus = () => {
    applyInstructionFocus(importedRootRef.current, propsRef.current.instructionFocusIds);
    applyInstructionFocus(brickRootRef.current, propsRef.current.instructionFocusIds);
    if (softwareSceneRef.current) applySoftwareInstructionFocus(softwareSceneRef.current, propsRef.current.instructionFocusIds);
    invalidatorRef.current?.();
  };
  const raycasterRef = useRef(new Raycaster());
  const propsRef = useRef({
    darkMode,
    emptyDoubleTapZoomEnabled,
    viewRotation,
    viewCamera, onViewCameraChange,
    instructionFocusIds,
    projectId,
    bricks,
    imported,
    selectedId,
    selectedIds,
    selectedRotationAnchor,
    selectedType,
    selectedColor,
    selectedColorCode,
    placementPreview,
    thickEdges,
    toolMode,
    onPlace,
    onSelect,
    onViewPartTap,
    onOpenRotationControls,
    onMove,
    onMoveGroup,
    moveConnectedAbove,
  });
  const pointersRef = useRef(new Map<number, PointerPoint>());
  const pointerLastRef = useRef(new Map<number, PointerPoint>());
  const gestureStartRef = useRef<GestureStart | null>(null);
  const gesturePairRef = useRef<readonly [number, number] | null>(null);
  const cameraOnlyRef = useRef(false);
  const cameraInteractionStartRef = useRef<{ theta: number; phi: number } | null>(null);
  const dragRef = useRef<DragCandidate | null>(null);
  const clickRef = useRef<{ id: number; start: PointerPoint; moved: boolean; startedAt: number } | null>(
    null,
  );
  const previousPartTapRef = useRef<{ id: string; x: number; y: number; at: number; toolMode: ToolMode } | null>(null);
  const previousEmptyTapRef = useRef<{ x: number; y: number; at: number; projectId?: string } | null>(null);
  const lastRotationOpenRef = useRef<{ id: string; at: number } | null>(null);
  const pendingTapActionRef = useRef<{ timer: number; projectId?: string; action: () => void } | null>(null);
  const cameraStateRef = useRef({
    theta: DEFAULT_INSTRUCTION_THETA,
    phi: DEFAULT_INSTRUCTION_PHI,
    distance: 17,
    target: new Vector3(0, 0, 0),
  });
  const cameraReferenceRef = useRef({
    distance: 17, target: new Vector3(), theta: DEFAULT_INSTRUCTION_THETA, phi: DEFAULT_INSTRUCTION_PHI,
  });
  const restoreStepCamera = () => {
    const stored = propsRef.current.viewCamera, state = cameraStateRef.current, reference = cameraReferenceRef.current;
    state.theta = stored?.theta ?? reference.theta;
    state.phi = stored?.phi ?? reference.phi;
    state.distance = stored?.distance ?? reference.distance;
    state.target.copy(stored ? new Vector3(...stored.target) : reference.target);
    invalidatorRef.current?.();
  };

  propsRef.current = {
    darkMode,
    emptyDoubleTapZoomEnabled,
    viewRotation,
    viewCamera, onViewCameraChange,
    instructionFocusIds,
    projectId,
    bricks,
    imported,
    selectedId,
    selectedIds,
    selectedRotationAnchor,
    selectedType,
    selectedColor,
    selectedColorCode,
    placementPreview,
    thickEdges,
    toolMode,
    onPlace,
    onSelect,
    onViewPartTap,
    onOpenRotationControls,
    onMove,
    onMoveGroup,
    moveConnectedAbove,
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new Scene();
    scene.background = new Color(darkMode ? "#111a18" : "#eef1ec");
    const camera = new PerspectiveCamera(42, 1, 0.1, 4000);
    let renderer: WebGLRenderer | FallbackRenderer;
    const renderCanvas = document.createElement("canvas");
    const webglContext = renderCanvas.getContext("webgl2", {
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    if (webglContext) {
      renderer = new WebGLRenderer({
        canvas: renderCanvas,
        context: webglContext,
        antialias: false,
        alpha: false,
        powerPreference: "high-performance",
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
      renderer.outputColorSpace = SRGBColorSpace;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = PCFSoftShadowMap;
    } else {
      renderer = new FallbackRenderer();
      renderer.domElement.setAttribute("data-renderer", "canvas-fallback");
    }
    renderer.domElement.setAttribute("class", "builder-webgl-canvas");
    renderer.domElement.setAttribute("aria-label", "Interactive 3D brick building area");
    renderer.domElement.setAttribute("role", "application");
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.userSelect = "none";
    host.appendChild(renderer.domElement);
    const overlay = new ConnectionOverlay(host);
    overlayRef.current = overlay;
    const contextLost = (event: Event) => {
      if (rendererRef.current !== renderer) return;
      event.preventDefault();
      setForceCompatibility(true);
    };
    renderer.domElement.addEventListener("webglcontextlost", contextLost);

    scene.add(createBuilderLighting());

    const boardMaterial = new MeshLambertMaterial({ color: darkMode ? "#1d2b26" : "#e1e6df" });
    const board = new Mesh(new BoxGeometry(34, 0.14, 34), boardMaterial);
    board.name = "construction-floor";
    board.position.y = -0.1;
    board.receiveShadow = true;
    scene.add(board);
    const gridMaterial = new LineBasicMaterial({
      color: darkMode ? "#91ad9b" : "#96a99d",
      transparent: true,
      opacity: darkMode ? 0.72 : 0.62,
    });
    const grid = new LineSegments(createStudGridGeometry(constructionArea(new Box3())), gridMaterial);
    grid.name = "construction-grid";
    grid.position.set(0, -0.025, 0);
    scene.add(grid);
    let floorSignature = "";
    const refreshConstructionArea = (candidate?: Box3) => {
      const bounds = candidate
        ? constructionBoundsRef.current.clone().union(candidate)
        : new Box3();
      if (!candidate) {
        for (const brick of propsRef.current.bricks) bounds.union(brickConstructionBounds(brick));
        const model = propsRef.current.imported;
        if (model && sceneModelRef.current === model) {
          const root = importedRootRef.current;
          if (root) {
            root.updateMatrixWorld(true);
            const index = instanceIndex(root);
            for (const entry of index?.records.values() ?? []) {
              if (!entry.bounds.isEmpty()) bounds.union(entry.bounds.clone().applyMatrix4(root.matrixWorld));
            }
          } else if (softwareSceneRef.current) {
            const offset = new Vector3(0, importedOffsetRef.current, 0);
            for (const instanceBounds of softwareSceneRef.current.instanceBounds.values()) {
              bounds.union(instanceBounds.clone().translate(offset));
            }
          }
        }
        constructionBoundsRef.current.copy(bounds);
      } else {
        constructionBoundsRef.current.union(candidate);
      }
      const area = constructionArea(bounds);
      const signature = [area.minX, area.maxX, area.minZ, area.maxZ, area.gridStride].join(":");
      if (signature === floorSignature) return;
      floorSignature = signature;
      constructionAreaRef.current = area;
      const previousBoardGeometry = board.geometry;
      board.geometry = new BoxGeometry(area.width, 0.14, area.depth);
      board.position.set(area.centerX, -0.1, area.centerZ);
      previousBoardGeometry.dispose();
      const previousGridGeometry = grid.geometry;
      grid.geometry = createStudGridGeometry(area);
      grid.position.set(area.centerX, -0.025, area.centerZ);
      previousGridGeometry.dispose();
      invalidatorRef.current?.();
    };
    refreshConstructionAreaRef.current = refreshConstructionArea;
    refreshConstructionArea();

    const brickRoot = new Group();
    scene.add(brickRoot);
    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    brickRootRef.current = brickRoot;

    const cameraState = cameraStateRef.current;
    makeCameraPosition(
      camera,
      cameraState.target,
      cameraState.theta,
      cameraState.phi,
      cameraState.distance,
    );

    let animationFrame: number | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let lastPixelRatio = Math.min(window.devicePixelRatio || 1, 1.25);
    const invalidate = () => {
      if (animationFrame !== null) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        const preview = pendingPreviewRef.current;
        pendingPreviewRef.current = null;
        preview?.();
        const interactive = performance.now() - interactionTimeRef.current < 180;
        // Rebuild from the untouched touch-camera state each time: step changes
        // must not accumulate rotations or rebuild thousands of model meshes.
        const state = cameraStateRef.current;
        makeCameraPosition(camera, state.target, state.theta, state.phi, state.distance);
        applyInstructionCameraRotation(camera, state.target, propsRef.current.viewRotation);
        const activeRenderer = rendererRef.current ?? renderer;
        if (activeRenderer instanceof WebGLRenderer) {
          const ratio = interactive ? 0.85 : Math.min(window.devicePixelRatio || 1, 1.25);
          if (ratio !== lastPixelRatio) { activeRenderer.setPixelRatio(ratio); lastPixelRatio = ratio; }
          scene.traverse(object => {
            if (!(object instanceof Mesh) || !object.userData.isWideEdgeMesh ||
              !(object.material instanceof ShaderMaterial)) return;
            const enabled = propsRef.current.thickEdges;
            object.material.uniforms.lineWidth.value = enabled ? THICK_EDGE_WIDTH_PX : 1;
            object.material.uniforms.edgeOpacity.value = enabled ? 1 : 0.25;
            object.material.uniforms.edgeColor.value.set(propsRef.current.darkMode ? "#ffffff" : "#000000");
            if (object.name.startsWith("brick-edges-")) object.visible = enabled;
            setWideLineResolution(object.material, renderCanvas.width, renderCanvas.height);
          });
            importedRootRef.current?.children.forEach(child => {
              if (child.name === "ldraw:instanced-edges") {
                child.visible = propsRef.current.thickEdges || !interactive;
              }
            });
          try { activeRenderer.render(scene, camera); }
          catch { setForceCompatibility(true); }
        } else {
          activeRenderer.render(
            camera,
            cameraStateRef.current.target,
            previewBrickRef.current ? propsRef.current.bricks.map(brick => brick.id === previewBrickRef.current!.id ? previewBrickRef.current! : brick) : propsRef.current.bricks,
            propsRef.current.selectedId,
            softwareSceneRef.current,
            importedOffsetRef.current,
            interactive,
            propsRef.current.instructionFocusIds,
            constructionAreaRef.current,
            propsRef.current.darkMode,
            placementPreviewGeometryRef.current,
            placementPreviewBrickRef.current,
            propsRef.current.thickEdges,
          );
        }
        const marker = rotationAnchorMarkerRef.current;
        const selectedAnchor = propsRef.current.selectedRotationAnchor;
        const selectedInstance = selectedAnchor && propsRef.current.selectedId
          ? propsRef.current.imported?.instances.find(instance => instance.id === propsRef.current.selectedId)
          : undefined;
        if (marker && selectedAnchor && selectedInstance && sceneModelRef.current === propsRef.current.imported) {
          camera.updateMatrixWorld(true);
          let displayMatrix = selectedInstance.matrix;
          const drag = dragRef.current;
          const draggedMember = drag?.members.find(member => member.id === selectedInstance.id);
          if (drag && draggedMember?.matrix && drag.destination) {
            if (drag.members.length > 1) {
              displayMatrix = [...draggedMember.matrix] as Affine;
              displayMatrix[3] += (drag.destination.x - drag.origin.x) * 20;
              displayMatrix[7] -= (drag.destination.y - drag.origin.y) * 20;
              displayMatrix[11] += (drag.destination.z - drag.origin.z) * 20;
            } else if (drag.connection) {
              displayMatrix = drag.connection.matrix;
            } else if (drag.id === selectedInstance.id) {
              displayMatrix = [...draggedMember.matrix] as Affine;
              displayMatrix[3] = drag.destination.x * 20;
              displayMatrix[7] = -(drag.destination.y - importedOffsetRef.current) * 20;
              displayMatrix[11] = drag.destination.z * 20;
            }
          }
          const screenPoint = new Vector3(...selectedAnchor)
            .applyMatrix4(worldMatrix(displayMatrix));
          screenPoint.y += importedOffsetRef.current;
          screenPoint.project(camera);
          if (screenPoint.x >= -1 && screenPoint.x <= 1 &&
            screenPoint.y >= -1 && screenPoint.y <= 1 &&
            screenPoint.z >= -1 && screenPoint.z <= 1) {
            const rectangle = host.getBoundingClientRect();
            marker.style.display = "grid";
            marker.style.left = `${(screenPoint.x + 1) * rectangle.width / 2}px`;
            marker.style.top = `${(1 - screenPoint.y) * rectangle.height / 2}px`;
          } else {
            marker.style.display = "none";
          }
        } else if (marker) {
          marker.style.display = "none";
        }
        overlay.draw(camera, importedOffsetRef.current, id => {
          const box = importedRootRef.current ? instanceIndex(importedRootRef.current)?.records.get(id)?.bounds : softwareSceneRef.current?.instanceBounds.get(id);
          return box ?? null;
        });
        const focus = propsRef.current.instructionFocusIds;
        if (focus?.size) {
          const { bricks, imported } = propsRef.current;
          const offset = importedOffsetRef.current;
          let cached = instructionOutlineCacheRef.current;
          if (!cached || cached.bricks !== bricks || cached.imported !== imported || cached.focus !== focus || cached.offset !== offset) {
            const occurrences = instructionHighlightOccurrences(bricks, imported);
            const groups = groupInstructionHighlights(occurrences, focus);
            const importedIds = new Set(imported?.instances.map(part => part.id));
            const boxes = new Map(occurrences.map(part => {
              const box = part.bounds.clone();
              if (importedIds.has(part.id)) box.translate(new Vector3(0, offset, 0));
              else box.max.y += 0.24; // Preserve the preview's existing stud clearance.
              return [part.id, box];
            }));
            cached = { bricks, imported, focus, offset, boxes: instructionGroupBounds(groups, boxes) };
            instructionOutlineCacheRef.current = cached;
          }
          const context = overlay.canvas.getContext("2d");
          if (context) drawInstructionOutlines(context, camera, cached.boxes, overlay.canvas.width, overlay.canvas.height);
        }
        if (interactive) {
          clearTimeout(settleTimer);
          settleTimer = setTimeout(invalidate, 190);
        }
      });
    };
    invalidatorRef.current = invalidate;

    const resizeObserver = new ResizeObserver(() => {
      const { width, height } = host.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      setRendererSize(rendererRef.current ?? renderer, width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      // The user may have deliberately zoomed the model. UI changes such as
      // selecting a part resize this canvas; keep the camera distance and
      // target instead of fitting the model again on every resize.
      invalidate();
    });
    resizeObserver.observe(host);
    invalidate();

    return () => {
      overlay.dispose(); if (overlayRef.current === overlay) overlayRef.current = null;
      resizeObserver.disconnect();
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      clearTimeout(settleTimer);
      invalidatorRef.current = null;
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      if (importedRootRef.current) {
        scene.remove(importedRootRef.current);
        disposeImported(importedRootRef.current);
        importedRootRef.current = null;
      }
      if (placementRootRef.current) {
        scene.remove(placementRootRef.current);
        if (placementRootRef.current instanceof Group) disposeImportedScene(placementRootRef.current);
        else {
          placementRootRef.current.geometry.dispose();
          disposeMaterial(placementRootRef.current.material);
        }
        placementRootRef.current = null;
      }
      placementIndexRef.current = null;
      placementPreviewGeometryRef.current = null;
      placementPreviewBrickRef.current = null;
      placementSourceMatrixRef.current = null;
      scene.traverse((object) => {
        if (object instanceof InstancedMesh) object.dispose();
        if (object instanceof Mesh) {
          disposeMaterial(object.material);
          if (!geometryCacheHas(object.geometry)) object.geometry.dispose();
        } else if (object instanceof LineSegments) {
          disposeMaterial(object.material);
          object.geometry.dispose();
        }
      });
      if (renderer instanceof WebGLRenderer) renderer.dispose();
      renderer.domElement.remove();
      if (rendererRef.current && rendererRef.current !== renderer) rendererRef.current.domElement.remove();
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      brickRootRef.current = null;
      refreshConstructionAreaRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    const board = scene?.getObjectByName("construction-floor");
    const grid = scene?.getObjectByName("construction-grid");
    if (!scene || !(board instanceof Mesh) || !(board.material instanceof MeshLambertMaterial) ||
      !(grid instanceof LineSegments) || !(grid.material instanceof LineBasicMaterial)) return;
    scene.background = new Color(darkMode ? "#111a18" : "#eef1ec");
    board.material.color.set(darkMode ? "#1d2b26" : "#e1e6df");
    grid.material.color.set(darkMode ? "#91ad9b" : "#96a99d");
    grid.material.opacity = darkMode ? 0.72 : 0.62;
    invalidatorRef.current?.();
  }, [darkMode]);

  useEffect(() => {
    const previous = placementContextRef.current;
    if (previous.projectId !== projectId) {
      stalePlacementPreviewRef.current = !!placementPreview && placementPreview === previous.preview;
      placementTargetRef.current = null;
      placementMatrixRef.current = null;
    } else if (previous.preview !== placementPreview) {
      stalePlacementPreviewRef.current = false;
      placementTargetRef.current = null;
      placementMatrixRef.current = null;
    }
    placementContextRef.current = { projectId, preview: placementPreview };
  }, [projectId, placementPreview]);

  useEffect(() => { invalidatorRef.current?.(); }, [thickEdges]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (placementRootRef.current) {
      scene.remove(placementRootRef.current);
      if (placementRootRef.current instanceof Group) disposeImportedScene(placementRootRef.current);
      else {
        placementRootRef.current.geometry.dispose();
        disposeMaterial(placementRootRef.current.material);
      }
    }
    placementRootRef.current = null;
    placementIndexRef.current = null;
    placementPreviewGeometryRef.current = null;
    placementPreviewBrickRef.current = null;
    placementSourceMatrixRef.current = null;
    placementBottomRef.current = 0;
    if (toolMode !== "build" || stalePlacementPreviewRef.current) {
      invalidatorRef.current?.();
      return;
    }
    const target = placementTargetRef.current ?? cameraStateRef.current.target;
    placementTargetRef.current = { ...target };
    if (placementPreview) {
      try {
        const source = placementPreview.model.instances[0];
        if (!source || source.part.status !== "resolved") throw new Error("Part geometry is unavailable.");
        const colorCode = appearanceCode(selectedColor, selectedColorCode);
        const instance = { ...source, id: PLACEMENT_PREVIEW_ID, colorCode, color: resolveColor(colorCode) };
        const model: ImportedModel = { ...placementPreview.model, instances: [instance] };
        const matrix = placementMatrixRef.current
          ? [...placementMatrixRef.current] as Affine
          : [...source.matrix] as Affine;
        if (!placementMatrixRef.current) {
          matrix[3] = target.x * 20;
          matrix[7] = (placementPreview.bottom - target.y) * 20;
          matrix[11] = target.z * 20;
        }
        placementSourceMatrixRef.current = [...source.matrix] as Affine;
        placementBottomRef.current = placementPreview.bottom;
        placementPreviewGeometryRef.current = {
          surfaces: compilePart(model, source.reference, "16"), matrix, colorCode,
        };
        if (rendererRef.current instanceof WebGLRenderer) {
          const root = createImportedGroup(model);
          const index = new InstanceIndex(root, model);
          index.preview(PLACEMENT_PREVIEW_ID, matrix);
          root.name = "placement-preview";
          root.traverse(object => {
            if (!(object instanceof Mesh)) return;
            for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
              material.transparent = true;
              material.opacity = (material.opacity ?? 1) * 0.72;
              material.depthWrite = false;
            }
            object.renderOrder = 5;
          });
          scene.add(root);
          placementRootRef.current = root;
          placementIndexRef.current = index;
        }
      } catch (error) {
        setToggleToast(`${placementPreview.part.ldrawId}: ${error instanceof Error ? error.message : String(error)}`);
        placementPreviewGeometryRef.current = null;
      }
    } else {
      const brick: Brick = {
        id: "placement-preview-brick", type: selectedType, color: selectedColor,
        x: target.x, y: target.y, z: target.z, rotation: 0,
      };
      placementPreviewBrickRef.current = brick;
      if (rendererRef.current instanceof WebGLRenderer) {
        const material = new MeshLambertMaterial({
          color: selectedColor, transparent: true, opacity: 0.72, depthWrite: false,
        });
        const mesh = new Mesh(brickGeometry(selectedType).clone(), material);
        mesh.name = "placement-preview";
        mesh.position.set(target.x, target.y, target.z);
        mesh.renderOrder = 5;
        scene.add(mesh);
        placementRootRef.current = mesh;
      }
    }
    invalidatorRef.current?.();
  }, [placementPreview, projectId, selectedColor, selectedColorCode, selectedType, toolMode]);

  useEffect(() => {
    invalidatorRef.current?.();
  }, [viewRotation?.[0], viewRotation?.[1], viewRotation?.[2]]);

  useEffect(() => {
    invalidatorRef.current?.();
  }, [selectedRotationAnchor?.[0], selectedRotationAnchor?.[1], selectedRotationAnchor?.[2]]);

  useEffect(() => { refreshInstructionFocus(); }, [instructionFocusIds]);
  useEffect(() => { if (viewStepId) restoreStepCamera(); }, [viewStepId, viewCamera]);

  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!scene || !camera) return;
    const previous = importedRootRef.current;
    const previousModel = sceneModelRef.current;
    const sameModel = sceneProjectRef.current === projectId && !!imported && previousModel?.originalBytes === imported.originalBytes;
    const previousOffset = importedOffsetRef.current;
    rollbackRef.current?.();
    const retry = attemptRef.current !== buildAttempt;
    attemptRef.current = buildAttempt;
    if (imported) reuseGeometryCache(previousModel, imported);
    if (imported && sameModel && !retry && !forceCompatibility) {
      try {
        const index = previous && instanceIndex(previous);
        const software = softwareSceneRef.current;
        if ((index && index.update(imported)) || (software && updateSoftwareScene(software, imported))) {
          refreshInstructionFocus();
          sceneModelRef.current = imported;
          setSceneStatus(null);
          refreshConstructionAreaRef.current?.();
          if (software) setRenderWarning(softwareWarning(software, localeRef.current, translateRef.current));
          updateImportedSelection();
          refreshConnections();
          return;
        }
      } catch (error) {
        setRenderWarning(translateRef.current("canvas.renderUpdateError", { reason: error instanceof Error ? error.message : String(error) }));
        return;
      }
    }
    // Software stays incremental after an explicit switch to compatibility mode.
    if (imported && sameModel && !retry && softwareSceneRef.current && forceCompatibility) {
      try {
        if (updateSoftwareScene(softwareSceneRef.current, imported)) {
          refreshInstructionFocus();
          sceneModelRef.current = imported; setSceneStatus(null);
          refreshConstructionAreaRef.current?.();
          refreshConnections();
          setRenderWarning(softwareWarning(softwareSceneRef.current, localeRef.current, translateRef.current));
          invalidatorRef.current?.(); return;
        }
      } catch (error) { setRenderWarning(translateRef.current("canvas.compatibilityUpdateError", { reason: String(error) })); return; }
    }
    const controller = new AbortController();
    buildControllerRef.current = controller;
    setRenderWarning(null);
    setSceneStatus(imported ? translateRef.current("canvas.prepareModel") : null);
    const build = async () => {
      if (!imported) {
        if (previous) { scene.remove(previous); disposeImported(previous); }
        importedRootRef.current = null; softwareSceneRef.current = undefined;
        importedBoundsRef.current = null; importedOffsetRef.current = 0; sceneModelRef.current = undefined;
        updateImportedSelection();
        refreshConnections();
        refreshConstructionAreaRef.current?.();
        return;
      }
      let lastProgress = 0;
      const progress = (stage: MessageId) => (completed: number, total: number) => {
        if (controller.signal.aborted || performance.now() - lastProgress < 80) return;
        lastProgress = performance.now();
        setSceneStatus(translateRef.current("canvas.progress", { stage: translateRef.current(stage), done: completed, total }));
      };
      await prepareGeometry(imported, { signal: controller.signal, onProgress: progress("canvas.geometryStage") });
      let root: Group | null = null, bounds: Box3;
      let software: SoftwareScene | undefined;
      if (rendererRef.current instanceof WebGLRenderer && !forceCompatibility) {
        try {
          const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
          const maxGeometryBytes = (memory <= 1 ? 32 : memory <= 2 ? 64 : 96) * 1024 * 1024;
          root = await createImportedGroupAsync(imported, {
            signal: controller.signal, onProgress: progress("canvas.sceneStage"), maxGeometryBytes,
          });
        } catch (error) {
          if (!(error instanceof SceneBudgetExceeded)) throw error;
          // Budget is checked before GPU upload; switch instead of risking a
          // driver/context crash or throwing away the user's model.
        }
      }
      if (root) {
        try {
          const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
          new InstanceIndex(root, imported, (memory <= 1 ? 32 : memory <= 2 ? 64 : 96) * 1024 * 1024);
          bounds = new Box3().setFromObject(root);
        } catch (error) { disposeImported(root); throw error; }
      }
      else {
        software = await createSoftwareScene(imported, { signal: controller.signal, onProgress: progress("canvas.compatibilityStage") });
        controller.signal.throwIfAborted();
        if (rendererRef.current instanceof WebGLRenderer) {
          const previousRenderer = rendererRef.current;
          previousRenderer.dispose();
          previousRenderer.domElement.remove();
          const fallback = new FallbackRenderer();
          fallback.domElement.className = "builder-webgl-canvas";
          fallback.domElement.setAttribute("data-renderer", "canvas-fallback");
          fallback.domElement.setAttribute("aria-label", translateRef.current("canvas.fallbackAria"));
          fallback.domElement.style.touchAction = "none";
          const rectangle = hostRef.current!.getBoundingClientRect();
          fallback.setSize(rectangle.width, rectangle.height);
          hostRef.current!.appendChild(fallback.domElement);
          rendererRef.current = fallback;
        }
        bounds = software.bounds.clone();
        setRenderWarning(softwareWarning(software, localeRef.current, translateRef.current));
      }
      if (controller.signal.aborted) { if (root) disposeImported(root); return; }
      if (previous) { scene.remove(previous); disposeImported(previous); }
      importedRootRef.current = null;
      softwareSceneRef.current = software;
      sceneModelRef.current = imported;
      sceneProjectRef.current = projectId;
      if (!bounds.isEmpty()) {
        const offset = sameModel ? previousOffset : Math.max(0, -bounds.min.y);
        if (root) root.position.y = offset;
        importedOffsetRef.current = offset;
        bounds.translate(new Vector3(0, offset, 0));
        importedBoundsRef.current = bounds;
        const rectangle = hostRef.current?.getBoundingClientRect();
        if (rectangle && rectangle.height > 0) {
          camera.aspect = rectangle.width / rectangle.height;
          camera.updateProjectionMatrix();
        }
        if (!sameModel) {
          fitImportedView(camera, bounds, cameraStateRef.current);
          const state = cameraStateRef.current;
          cameraReferenceRef.current = { distance: state.distance, target: state.target.clone(), theta: state.theta, phi: state.phi };
          if (propsRef.current.viewCamera) restoreStepCamera();
        }
      }
      if (root) { scene.add(root); importedRootRef.current = root; }
      refreshConstructionAreaRef.current?.();
      refreshInstructionFocus();
      updateImportedSelection();
      refreshConnections();
      setSceneStatus(null);
      invalidatorRef.current?.();
    };
    void build().catch(error => {
      if (controller.signal.aborted) return;
      setSceneStatus(null);
      setRenderWarning(translateRef.current("canvas.buildFailed", { reason: error instanceof Error ? error.message : String(error) }));
    });
    invalidatorRef.current?.();
    return () => {
      controller.abort();
    };
  }, [imported, buildAttempt, forceCompatibility, projectId]);

  useEffect(() => { rollbackRef.current?.(); }, [projectId, toolMode]);
  useEffect(() => {
    if (dragRef.current && (dragRef.current.id !== selectedId || sceneModelRef.current !== imported)) rollbackRef.current?.();
    if (!dragRef.current) refreshConnections();
    invalidatorRef.current?.();
  }, [imported, selectedId, projectId]);
  useEffect(() => {
    if (overlayRef.current) overlayRef.current.visible = showConnections;
    invalidatorRef.current?.();
  }, [showConnections]);
  useEffect(() => {
    const controller = new AbortController();
    if (overlayRef.current) overlayRef.current.collisions = new Map();
    setCollisionState({
      count: 0, uncertain: false, pending: showCollisions, failed: false,
      progress: showCollisions ? { phase: "preparing", percent: 0 } : null,
    });
    invalidatorRef.current?.();
    if (showCollisions) {
      const offset = sceneModelRef.current && sceneProjectRef.current === projectId ? importedOffsetRef.current : undefined;
      void collisionWarningsInWorker(bricks, imported, controller.signal, offset, progress => {
        if (controller.signal.aborted) return;
        setCollisionState(current => current.pending ? { ...current, progress } : current);
      }).then(result => {
        if (controller.signal.aborted) return;
        if (overlayRef.current) overlayRef.current.collisions = result.boxes;
        setCollisionState({ count: result.boxes.size, uncertain: result.uncertain, pending: false, failed: false, progress: null });
        invalidatorRef.current?.();
      }).catch(error => {
        if (!controller.signal.aborted) {
          setCollisionState({ count: 0, uncertain: true, pending: false, failed: true, progress: null });
          setToggleToast(translateRef.current("canvas.collisionFailedToast"));
          console.error(error);
        }
      });
    }
    return () => controller.abort();
  }, [showCollisions, bricks, imported, projectId, buildAttempt]);

  useEffect(() => { updateImportedSelection(); }, [selectedId]);
  useEffect(() => { refreshFloating(); }, [bricks]);
  useEffect(() => { refreshFloating(); }, [showFloating]);

  useEffect(() => {
    const scene = sceneRef.current;
    const previousRoot = brickRootRef.current;
    if (!scene || !previousRoot) return;
    scene.remove(previousRoot);
    previousRoot.traverse((object) => {
      if (object instanceof InstancedMesh) object.dispose();
      if (object instanceof Mesh) {
        disposeMaterial(object.material);
        if (!geometryCacheHas(object.geometry)) object.geometry.dispose();
      } else if (object instanceof LineSegments) {
        disposeMaterial(object.material);
        object.geometry.dispose();
      }
    });

    const nextRoot = new Group();
    const groups = new Map<string, Brick[]>();
    for (const brick of bricks) {
      const key = `${brick.type}|${brick.color.toLowerCase()}`;
      const group = groups.get(key) ?? [];
      group.push(brick);
      groups.set(key, group);
    }

    for (const groupBricks of groups.values()) {
      const first = groupBricks[0];
      const material = new MeshLambertMaterial({ color: first.color });
      const instances = new InstancedMesh(
        // Focus is occurrence-specific; never attach its buffer to the shared cache.
        brickGeometry(first.type)!.clone(),
        material,
        groupBricks.length,
      );
      instances.castShadow = true;
      instances.receiveShadow = true;
      instances.userData.brickIds = groupBricks.map((brick) => brick.id);
      installInstructionFocus(instances);
      instances.name = `brick-group-${first.type}`;
      groupBricks.forEach((brick, index) => {
        instances.setMatrixAt(index, brickTransformMatrix(brick));
      });
      instances.instanceMatrix.needsUpdate = true;
      nextRoot.add(instances);
    }

    const localEdgeGroups = new Map<BrickType, Brick[]>();
    for (const brick of bricks) {
      const group = localEdgeGroups.get(brick.type) ?? [];
      group.push(brick);
      localEdgeGroups.set(brick.type, group);
    }
    for (const [type, groupBricks] of localEdgeGroups) {
      const expanded = expandWideLines(localBrickEdges(type));
      const geometry = new InstancedBufferGeometry();
      for (const [name, attribute] of Object.entries(expanded.attributes)) geometry.setAttribute(name, attribute);
      expanded.dispose();
      const rows = [new Float32Array(groupBricks.length * 4), new Float32Array(groupBricks.length * 4), new Float32Array(groupBricks.length * 4)];
      const bounds = new Box3(), transformed = new Box3();
      geometry.computeBoundingBox();
      const local = geometry.boundingBox!.clone();
      groupBricks.forEach((brick, index) => {
        const matrix = brickTransformMatrix(brick), elements = matrix.elements;
        for (let row = 0; row < 3; row++) rows[row].set(
          [elements[row], elements[4 + row], elements[8 + row], elements[12 + row]], index * 4,
        );
        bounds.union(transformed.copy(local).applyMatrix4(matrix));
      });
      rows.forEach((row, index) => geometry.setAttribute(`instanceRow${index}`, new InstancedBufferAttribute(row, 4)));
      geometry.setAttribute("instructionFocus", new InstancedBufferAttribute(new Float32Array(groupBricks.length), 1));
      geometry.instanceCount = groupBricks.length;
      geometry.boundingBox = bounds;
      geometry.computeBoundingSphere();
      const edgeMesh = new Mesh(geometry, wideLineMaterial());
      edgeMesh.name = `brick-edges-${type}`;
      edgeMesh.userData.brickIds = groupBricks.map(brick => brick.id);
      edgeMesh.userData.isWideEdgeMesh = true;
      edgeMesh.frustumCulled = false;
      nextRoot.add(edgeMesh);
    }

    const selected = bricks.find((brick) => brick.id === selectedId);
    if (selected) {
      const { studsX: width, studsZ: depth } = BRICK_DEFINITIONS[selected.type];
      const outlineHeight = BRICK_HEIGHT + 0.24;
      const outlineGeometry = new EdgesGeometry(
        new BoxGeometry(width + 0.1, outlineHeight, depth + 0.1),
      );
      outlineGeometry.translate(0, outlineHeight / 2, 0);
      const outline = new LineSegments(
        outlineGeometry,
        new LineBasicMaterial({ color: "#b84e37", transparent: true, opacity: 0.9 }),
      );
      outline.position.set(selected.x, selected.y, selected.z);
      outline.rotation.set(
        (selected.tiltX ?? 0) * Math.PI / 180,
        selected.rotation * Math.PI / 180,
        (selected.tiltZ ?? 0) * Math.PI / 180,
        "XYZ",
      );
      outline.userData.isSelectionOutline = true;
      nextRoot.add(outline);
    }

    scene.add(nextRoot);
    brickRootRef.current = nextRoot;
    refreshConstructionAreaRef.current?.();
    refreshInstructionFocus();
    invalidatorRef.current?.();
  }, [bricks, selectedId]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const updateCamera = (
      theta: number,
      phi: number,
      distance: number,
      target = cameraStateRef.current.target,
    ) => {
      const cameraState = cameraStateRef.current;
      const camera = cameraRef.current;
      if (!camera) return;
      cameraState.theta = theta;
      cameraState.phi = Math.max(0.25, Math.min(1.42, phi));
      const maxDistance = Math.max(1500, camera.far / 2);
      cameraState.distance = Math.max(3, Math.min(maxDistance, distance));
      cameraState.target.copy(target);
      interactionTimeRef.current = performance.now();
      makeCameraPosition(
        camera,
        cameraState.target,
        cameraState.theta,
        cameraState.phi,
        cameraState.distance,
      );
      invalidatorRef.current?.();
    };

    const makeRay = (point: PointerPoint) => {
      const rect = host.getBoundingClientRect();
      const ndc = new Vector2(
        ((point.x - rect.left) / rect.width) * 2 - 1,
        -((point.y - rect.top) / rect.height) * 2 + 1,
      );
      const camera = cameraRef.current;
      if (!camera) return null;
      const raycaster = raycasterRef.current;
      raycaster.setFromCamera(ndc, camera);
      return raycaster;
    };

    const findBrick = (point: PointerPoint): BrickHit | null => {
      const raycaster = makeRay(point);
      const root = brickRootRef.current;
      if (!raycaster || !root) return null;
      importedRootRef.current?.updateMatrixWorld(true);
      const brickMeshes = root.children.filter(
        (child): child is Mesh =>
          child instanceof Mesh &&
          (typeof child.userData.brickId === "string" ||
            Array.isArray(child.userData.brickIds)),
      );
      const intersections = raycaster.intersectObjects(brickMeshes, false);
      const hit = intersections[0];
      const sceneMatches = sceneModelRef.current === propsRef.current.imported && sceneProjectRef.current === propsRef.current.projectId;
      const importedRoot = sceneMatches ? importedRootRef.current : null;
      const importedHit = importedRoot ? instanceIndex(importedRoot)?.pick(raycaster) : null;
      const software = sceneMatches ? softwareSceneRef.current : undefined;
      const softwareHit = software ? pickSoftwareInstance(raycaster.ray, software, importedOffsetRef.current) : null;
      const sourceHit = importedHit ?? softwareHit;
      if (sourceHit && (!hit || sourceHit.point.distanceTo(raycaster.ray.origin) < hit.distance)) return sourceHit;
      if (!hit) return null;
      let id = hit.object.userData.brickId as string | undefined;
      if (!id && hit.instanceId !== undefined) {
        const ids = hit.object.userData.brickIds as string[] | undefined;
        id = ids?.[hit.instanceId];
      }
      return id ? { id, point: hit.point.clone() } : null;
    };

    const projectToPlane = (point: PointerPoint, y: number): Position3 | null => {
      const raycaster = makeRay(point);
      if (!raycaster) return null;
      const plane = new Plane(new Vector3(0, 1, 0), -y);
      const intersection = raycaster.ray.intersectPlane(plane, new Vector3());
      return intersection
        ? { x: intersection.x, y, z: intersection.z }
        : null;
    };
    const placementTarget = (point: PointerPoint): Position3 | null => {
      const hit = findBrick(point);
      if (!hit) return projectToPlane(point, 0);
      const brick = propsRef.current.bricks.find(item => item.id === hit.id);
      const y = brick ? brick.y + BRICK_HEIGHT : Math.max(0, hit.point.y);
      return projectToPlane(point, y);
    };
    let snapContext: { original?: ImportedModel; prepared: PreparedPart; model: ImportedModel } | undefined;
    let placementLatch: MagneticLatch | undefined;
    const updatePlacementPreview = (destination: Position3 | null): Affine | undefined => {
      if (!destination || propsRef.current.toolMode !== "build") return;
      const x = Math.round(destination.x * 2) / 2;
      const z = Math.round(destination.z * 2) / 2;
      placementTargetRef.current = { x, y: destination.y, z };
      const brick = placementPreviewBrickRef.current;
      if (brick) {
        const next = { ...brick, x, y: destination.y, z };
        placementPreviewBrickRef.current = next;
        const mesh = placementRootRef.current;
        if (mesh instanceof Mesh) {
          mesh.position.set(x, destination.y, z);
          mesh.rotation.set(0, 0, 0);
        }
      }
      const preview = placementPreviewGeometryRef.current;
      if (preview) {
        let matrix = [...(placementSourceMatrixRef.current ?? preview.matrix)] as Affine;
        matrix[3] = x * 20;
        matrix[7] = (placementBottomRef.current - destination.y) * 20;
        matrix[11] = z * 20;
        const { imported: original, placementPreview: prepared } = propsRef.current;
        if (prepared) {
          if (snapContext?.original !== original || snapContext?.prepared !== prepared) {
            snapContext = { original, prepared, model: placementSnapModel(original, prepared) };
            placementLatch = undefined;
          }
          const snapped = magneticConstructionTransform(snapContext.model, PLACEMENT_SNAP_ID, {
            x: destination.x,
            y: destination.y - importedOffsetRef.current - prepared.bottom,
            z: destination.z,
          }, placementLatch, Math.abs(destination.y) < 0.01);
          placementLatch = snapped.latch;
          matrix = [...snapped.transform.matrix] as Affine;
          if (overlayRef.current) overlayRef.current.contacts = snapped.transform.contacts;
          setConnectionStatus(snapped.transform.contacts.length
            ? translateRef.current("canvas.magnetSnapped", { count: snapped.transform.contacts.length })
            : "");
          // The preview root is in world coordinates; project transforms are not.
          const world = [...matrix] as Affine;
          world[7] -= importedOffsetRef.current * 20;
          preview.matrix = world;
          placementMatrixRef.current = [...world] as Affine;
          placementIndexRef.current?.preview(PLACEMENT_PREVIEW_ID, world);
          invalidatorRef.current?.();
          return matrix;
        }
        preview.matrix = matrix;
        placementMatrixRef.current = [...matrix] as Affine;
        placementIndexRef.current?.preview(PLACEMENT_PREVIEW_ID, matrix);
      }
      invalidatorRef.current?.();
      return undefined;
    };

    const rollback = () => {
      pendingPreviewRef.current = null;
      const drag = dragRef.current;
      if (drag) {
        for (const member of drag.members) {
          if (member.matrix) {
            if (importedRootRef.current) instanceIndex(importedRootRef.current)?.restore(member.id);
            if (softwareSceneRef.current) restoreSoftware(softwareSceneRef.current, member.id);
          }
          if (member.brick) applyBrickPreview(member.brick);
        }
      }
      previewBrickRef.current = null;
      dragRef.current = null; clickRef.current = null;
      refreshConstructionAreaRef.current?.();
      if (overlayRef.current) {
        overlayRef.current.contacts = [];
        overlayRef.current.previews = [];
      }
      setConnectionStatus("");
      updateImportedSelection();
    };
    rollbackRef.current = rollback;
    const applyBrickPreview = (brick: Brick) => {
      const dummy = new Object3D();
      dummy.position.set(brick.x, brick.y, brick.z);
      dummy.rotation.set((brick.tiltX ?? 0) * Math.PI / 180, brick.rotation * Math.PI / 180, (brick.tiltZ ?? 0) * Math.PI / 180, "XYZ");
      dummy.updateMatrix();
      for (const child of brickRootRef.current?.children ?? []) {
        if (child instanceof InstancedMesh) {
          const index = (child.userData.brickIds as string[]).indexOf(brick.id);
          if (index >= 0) { child.setMatrixAt(index, dummy.matrix); child.instanceMatrix.needsUpdate = true; child.boundingSphere = null; }
        } else if (child.userData.isSelectionOutline && brick.id === propsRef.current.selectedId) {
          child.position.set(brick.x, brick.y, brick.z);
          child.rotation.set((brick.tiltX ?? 0) * Math.PI / 180, brick.rotation * Math.PI / 180, (brick.tiltZ ?? 0) * Math.PI / 180, "XYZ");
        }
      }
    };
    const resolveDrag = (drag: DragCandidate) => {
      if (!drag.destination || !drag.needsSnap) return;
      if (drag.matrix && propsRef.current.imported) {
        const offset = importedOffsetRef.current;
        const instance = propsRef.current.imported.instances.find(item => item.id === drag.id);
        const bounds = stackingBounds(propsRef.current.imported).get(drag.id);
        const originY = instance ? -instance.matrix[7] / 20 + offset : drag.origin.y;
        const onConstructionFloor = !!bounds &&
          Math.abs(bounds.min.y + offset + drag.destination.y - originY) < 0.05;
        const requested = { ...drag.destination, y: drag.destination.y - offset };
        const magnetic = onConstructionFloor
          ? magneticConstructionTransform(propsRef.current.imported, drag.id, requested, drag.magneticLatch, true)
          : magneticConstructionTransform(propsRef.current.imported, drag.id, requested, drag.magneticLatch);
        drag.magneticLatch = magnetic.latch;
        const result = magnetic.transform;
        drag.connection = result;
        if (overlayRef.current) {
          overlayRef.current.contacts = result.contacts;
        }
        setConnectionStatus(result.status === "candidate"
          ? translateRef.current("canvas.magnetSnapped", { count: result.contacts.length })
          : result.status === "no-data" ? translateRef.current("canvas.connectionDataUnavailable") : translateRef.current("canvas.noMatchingConnection"));
        const position = { x: result.matrix[3] / 20, y: -result.matrix[7] / 20, z: result.matrix[11] / 20 };
        drag.destination = { ...position, y: position.y + offset };
      } else {
        const brick = drag.members.find(member => member.id === drag.id)?.brick;
        const originalBounds = brick ? brickConstructionBounds(brick) : null;
        const onConstructionFloor = !!originalBounds &&
          Math.abs(originalBounds.min.y + drag.destination.y - drag.origin.y) < 0.05;
        if (brick && onConstructionFloor) {
          const snapped = snapPosition(drag.destination);
          drag.destination.x = snapped.x;
          drag.destination.z = snapped.z;
        } else {
          drag.destination.x = Math.round(drag.destination.x * 2) / 2;
          drag.destination.z = Math.round(drag.destination.z * 2) / 2;
        }
      }
      drag.needsSnap = false;
    };
    const queuePreview = (drag: DragCandidate) => {
      pendingPreviewRef.current = () => {
        if (dragRef.current !== drag || !drag.destination) return;
        const grouped = drag.members.length > 1;
        if (!grouped) resolveDrag(drag);
        const position = drag.destination;
        if (grouped) {
          const delta = {
            x: position.x - drag.origin.x,
            y: position.y - drag.origin.y,
            z: position.z - drag.origin.z,
          };
          for (const member of drag.members) {
            if (member.matrix) {
              const matrix = [...member.matrix] as Affine;
              matrix[3] += delta.x * 20;
              matrix[7] -= delta.y * 20;
              matrix[11] += delta.z * 20;
              if (importedRootRef.current) instanceIndex(importedRootRef.current)?.preview(member.id, matrix);
              if (softwareSceneRef.current) previewSoftware(softwareSceneRef.current, member.id, matrix);
            } else if (member.brick) {
              const preview = { ...member.brick,
                x: member.brick.x + delta.x, y: member.brick.y + delta.y, z: member.brick.z + delta.z };
              applyBrickPreview(preview);
              refreshConstructionAreaRef.current?.(brickConstructionBounds(preview));
            }
          }
          updateImportedSelection();
        } else if (drag.matrix) {
          const matrix = [...(drag.connection?.matrix ?? drag.matrix)] as Affine;
          // Connection matrices are already in original LDU coordinates.
          // A scene-unit/floor-offset round trip changes exact off-grid values
          // and must not make the visible preview differ from the transaction.
          if (!drag.connection) {
            matrix[3] = position.x * 20; matrix[7] = -(position.y - importedOffsetRef.current) * 20; matrix[11] = position.z * 20;
          }
          if (importedRootRef.current) instanceIndex(importedRootRef.current)?.preview(drag.id, matrix);
          if (softwareSceneRef.current) previewSoftware(softwareSceneRef.current, drag.id, matrix);
          updateImportedSelection();
        } else {
          const brick = propsRef.current.bricks.find(value => value.id === drag.id);
          if (brick) {
            previewBrickRef.current = { ...brick, ...position };
            applyBrickPreview(previewBrickRef.current);
            refreshConstructionAreaRef.current?.(brickConstructionBounds(previewBrickRef.current));
          }
        }
        if (grouped) {
          const root = importedRootRef.current;
          if (root) {
            root.updateMatrixWorld(true);
            const groupBounds = new Box3();
            for (const member of drag.members) {
              if (member.matrix) {
                const record = instanceIndex(root)?.records.get(member.id);
                if (record && !record.bounds.isEmpty()) groupBounds.union(record.bounds);
              }
            }
            if (!groupBounds.isEmpty()) refreshConstructionAreaRef.current?.(groupBounds);
          }
        } else if (drag.matrix) {
          const root = importedRootRef.current;
          const record = root && instanceIndex(root)?.records.get(drag.id);
          if (record && !record.bounds.isEmpty()) {
            root.updateMatrixWorld(true);
            refreshConstructionAreaRef.current?.(record.bounds.clone().applyMatrix4(root.matrixWorld));
          } else {
            const bounds = softwareSceneRef.current?.instanceBounds.get(drag.id);
            if (bounds) refreshConstructionAreaRef.current?.(bounds.clone().translate(new Vector3(0, importedOffsetRef.current, 0)));
          }
        }
      };
      interactionTimeRef.current = performance.now();
      invalidatorRef.current?.();
    };

    const flushPendingTap = () => {
      const pending = pendingTapActionRef.current;
      if (!pending) return;
      window.clearTimeout(pending.timer);
      pendingTapActionRef.current = null;
      if (propsRef.current.projectId === pending.projectId) pending.action();
    };
    const placementOptions = (destination: Position3 | null) => {
      const options = {
        ...(!autoSelectAfterPlacementRef.current ? { stayInBuildMode: true } : {}),
        ...(destination && Math.abs(destination.y) < 0.01 ? { floorSnap: true } : {}),
      };
      return Object.keys(options).length ? options : undefined;
    };
    const placeAtCanvasPoint = (point: PointerPoint) => {
      if (propsRef.current.toolMode !== "build" || propsRef.current.emptyDoubleTapZoomEnabled === false) return false;
      const destination = projectToPlane(point, 0);
      if (!destination) return false;
      const transform = updatePlacementPreview(destination);
      propsRef.current.onPlace(
        { ...destination, y: destination.y - importedOffsetRef.current },
        transform,
        placementOptions(destination),
      );
      placementLatch = undefined;
      return true;
    };
    const openRotationControls = (id: string) => {
      const now = performance.now();
      const previous = lastRotationOpenRef.current;
      if (previous?.id === id && now - previous.at < 800) return;
      lastRotationOpenRef.current = { id, at: now };
      if (propsRef.current.onOpenRotationControls) propsRef.current.onOpenRotationControls(id);
      else propsRef.current.onSelect(id);
    };
    const startGesture = () => {
      const ids = [...pointersRef.current.keys()];
      if (ids.length < 2) {
        gestureStartRef.current = null;
        gesturePairRef.current = null;
        return;
      }
      gesturePairRef.current = [ids[0], ids[1]];
      cameraOnlyRef.current = true;
      const cameraState = cameraStateRef.current;
      cameraInteractionStartRef.current = { theta: cameraState.theta, phi: cameraState.phi };
      gestureStartRef.current = {
        points: [pointersRef.current.get(ids[0])!, pointersRef.current.get(ids[1])!],
        camera: { ...cameraState, target: cameraState.target.clone() },
      };
      rollback();
      clickRef.current = null;
      previousPartTapRef.current = null;
      previousEmptyTapRef.current = null;
      flushPendingTap();
    };

    const onPointerDown = (event: PointerEvent) => {
      // Overlay form controls (especially the range slider) must keep their
      // pointer gestures instead of starting a camera drag on the canvas host.
      if (event.target instanceof Element && event.target.closest("button, input, select, textarea")) return;
      event.preventDefault();
      host.setPointerCapture(event.pointerId);
      const point = { x: event.clientX, y: event.clientY };
      pointersRef.current.set(event.pointerId, point);
      pointerLastRef.current.set(event.pointerId, point);
      if (pointersRef.current.size > 1) {
        if (!gesturePairRef.current) startGesture();
        return;
      }

      const cameraState = cameraStateRef.current;
      cameraInteractionStartRef.current = { theta: cameraState.theta, phi: cameraState.phi };
      clickRef.current = { id: event.pointerId, start: point, moved: false, startedAt: performance.now() };
      const current = propsRef.current;
      const hit = current.toolMode === "view" ? null : findBrick(point);
      if (current.toolMode === "build") {
        placementLatch = undefined;
        updatePlacementPreview(placementTarget(point));
      }
      if (current.toolMode === "select") {
        if (hit) {
          const alreadySelected = current.selectedIds?.includes(hit.id) ?? false;
          if (!alreadySelected) current.onSelect(hit.id);
          const brick = current.bricks.find((item) => item.id === hit.id);
          const instance = current.imported?.instances.find(item => item.id === hit.id);
          const origin = brick ? { x: brick.x, y: brick.y, z: brick.z } :
            instance ? { x: instance.matrix[3] / 20, y: -instance.matrix[7] / 20 + importedOffsetRef.current, z: instance.matrix[11] / 20 } : null;
          if (origin) {
            const requestedIds = current.selectedIds?.includes(hit.id) ? current.selectedIds : [hit.id];
            const moveIds = current.moveConnectedAbove
              ? connectedPartsAbove(current.imported, current.bricks, requestedIds)
              : new Set(requestedIds);
            const members: DragMember[] = [
              ...current.bricks.filter(item => moveIds.has(item.id)).map(item => ({ id: item.id, brick: item })),
              ...(current.imported?.instances ?? []).filter(item => moveIds.has(item.id))
                .map(item => ({ id: item.id, matrix: [...item.matrix] as Affine })),
            ];
            if (!members.some(member => member.id === hit.id)) {
              members.push(brick
                ? { id: brick.id, brick }
                : { id: instance!.id, matrix: [...instance!.matrix] as Affine });
            }
            dragRef.current = {
              id: hit.id,
              pointerId: event.pointerId,
              start: point,
              origin,
              moved: false,
              destination: null,
              matrix: instance?.matrix,
              planeStart: projectToPlane(point, origin.y),
              members,
            };
          }
        } else {
          dragRef.current = null;
        }
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!pointersRef.current.has(event.pointerId)) {
        if (propsRef.current.toolMode === "build") {
          updatePlacementPreview(placementTarget({ x: event.clientX, y: event.clientY }));
        }
        return;
      }
      event.preventDefault();
      const previous = pointerLastRef.current.get(event.pointerId);
      const currentPoint = { x: event.clientX, y: event.clientY };
      pointerLastRef.current.set(event.pointerId, currentPoint);
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointersRef.current.size >= 2) {
        const start = gestureStartRef.current;
        const pair = gesturePairRef.current;
        if (!start || !pair) {
          startGesture();
          return;
        }
        if (!pair.includes(event.pointerId)) return;
        const rect = host.getBoundingClientRect();
        const next = cameraGesture(start, [pointersRef.current.get(pair[0])!, pointersRef.current.get(pair[1])!],
          { width: rect.width, height: rect.height, fov: cameraRef.current!.fov });
        updateCamera(next.theta, next.phi, next.distance, next.target);
        return;
      }
      // A remaining finger must not resume the part action or orbit after takeover.
      if (cameraOnlyRef.current) return;
      const click = clickRef.current;
      if (
        click?.id === event.pointerId &&
        Math.hypot(event.clientX - click.start.x, event.clientY - click.start.y) > 5
      ) {
        click.moved = true;
      }
      // A single finger belongs exclusively to the part in build mode.
      // Camera navigation remains available through two-finger gestures.
      if (propsRef.current.toolMode === "build") {
        updatePlacementPreview(placementTarget(currentPoint));
        return;
      }

      const start = dragRef.current;
      if (
        start &&
        start.pointerId === event.pointerId &&
        propsRef.current.toolMode === "select"
      ) {
        const dx = event.clientX - start.start.x;
        const dy = event.clientY - start.start.y;
        if (Math.hypot(dx, dy) > 5) start.moved = true;
        if (start.moved) {
          const destination = projectToPlane(
            { x: event.clientX, y: event.clientY },
            start.origin.y,
          );
          if (destination) {
            start.destination = {
              x: start.origin.x + destination.x - (start.planeStart?.x ?? start.origin.x),
              y: start.origin.y,
              z: start.origin.z + destination.z - (start.planeStart?.z ?? start.origin.z),
            };
            if (start.members.length > 1) {
              start.destination.x = Math.round(start.destination.x * 2) / 2;
              start.destination.z = Math.round(start.destination.z * 2) / 2;
              start.needsSnap = false;
            } else {
              start.needsSnap = true;
            }
            queuePreview(start);
          }
          return;
        }
      }

      if (!start) {
        const deltaX = previous ? currentPoint.x - previous.x : 0;
        const deltaY = previous ? currentPoint.y - previous.y : 0;
        const cameraState = cameraStateRef.current;
        updateCamera(
          cameraState.theta - deltaX * 0.008,
          cameraState.phi - deltaY * 0.006,
          cameraState.distance,
        );
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!pointersRef.current.has(event.pointerId)) return;
      const point = { x: event.clientX, y: event.clientY };
      const current = propsRef.current;
      const click = clickRef.current;
      const stationaryTap = pointersRef.current.size === 1 && !cameraOnlyRef.current &&
        !!click && !click.moved && performance.now() - click.startedAt < VIEW_TAP_MAX_DURATION_MS;
      const physicalTapHit = stationaryTap ? findBrick(point) : null;
      const tapHit = stationaryTap && (current.toolMode !== "view" || autoSelectOnTapRef.current)
        ? physicalTapHit : null;
      let suppressTapAction = false;
      const emptyTapActionsEnabled = current.emptyDoubleTapZoomEnabled !== false;
      const emptyZoomMode = EMPTY_DOUBLE_TAP_ZOOM_MODES.has(current.toolMode);
      const buildEmptyTap = current.toolMode === "build" && emptyTapActionsEnabled;
      if (
        stationaryTap &&
        !physicalTapHit &&
        emptyTapActionsEnabled &&
        (emptyZoomMode || buildEmptyTap)
      ) {
        const now = performance.now();
        const previousTap = previousEmptyTapRef.current;
        const sameProject = !!previousTap && previousTap.projectId === current.projectId;
        const isDoubleTap = sameProject && now - previousTap.at <= DOUBLE_TAP_INTERVAL_MS &&
          Math.hypot(point.x - previousTap.x, point.y - previousTap.y) <= 48;
        previousPartTapRef.current = null;
        if (isDoubleTap) {
          previousEmptyTapRef.current = null;
          if (pendingTapActionRef.current) {
            window.clearTimeout(pendingTapActionRef.current.timer);
            pendingTapActionRef.current = null;
          }
          if (current.toolMode === "build") {
            placeAtCanvasPoint(point);
          } else {
            const state = cameraStateRef.current;
            updateCamera(state.theta, state.phi, state.distance / EMPTY_DOUBLE_TAP_ZOOM_FACTOR);
            current.onViewCameraChange?.({
              theta: state.theta, phi: state.phi, distance: state.distance, target: state.target.toArray(),
              referenceDistance: cameraReferenceRef.current.distance,
              referenceTarget: cameraReferenceRef.current.target.toArray(),
            });
          }
          suppressTapAction = true;
        } else {
          previousEmptyTapRef.current = { x: point.x, y: point.y, at: now, projectId: current.projectId };
          if (current.toolMode === "build") {
            const projectAtTap = current.projectId;
            const timer = window.setTimeout(() => {
              if (pendingTapActionRef.current?.timer !== timer) return;
              pendingTapActionRef.current = null;
              previousEmptyTapRef.current = null;
              if (propsRef.current.projectId !== projectAtTap) return;
              placeAtCanvasPoint(point);
            }, BUILD_SINGLE_TAP_DELAY_MS);
            pendingTapActionRef.current = {
              timer,
              projectId: projectAtTap,
              action: () => { placeAtCanvasPoint(point); },
            };
            suppressTapAction = true;
          }
        }
      } else if (tapHit && stationaryTap) {
        previousEmptyTapRef.current = null;
        const previousTap = previousPartTapRef.current;
        const now = performance.now();
        const isDoubleTap = previousTap?.id === tapHit.id &&
          now - previousTap.at <= DOUBLE_TAP_INTERVAL_MS &&
          Math.hypot(point.x - previousTap.x, point.y - previousTap.y) <= 48;
        if (isDoubleTap && current.toolMode === "select" && previousTap?.toolMode === "select") {
          if (pendingTapActionRef.current) {
            window.clearTimeout(pendingTapActionRef.current.timer);
            pendingTapActionRef.current = null;
          }
          previousPartTapRef.current = null;
          rollback();
          dragRef.current = null;
          openRotationControls(tapHit.id);
          suppressTapAction = true;
        } else if (isDoubleTap) {
          // In View/Build/Delete, a double tap has no second action. A pending
          // Build tap is completed once, then the second tap is discarded.
          if (current.toolMode === "build") flushPendingTap();
          previousPartTapRef.current = null;
          suppressTapAction = true;
        } else {
          flushPendingTap();
          previousPartTapRef.current = { id: tapHit.id, x: point.x, y: point.y, at: now, toolMode: current.toolMode };
          if (current.toolMode === "build") {
            const brick = current.bricks.find(item => item.id === tapHit.id);
            const y = brick ? brick.y + BRICK_HEIGHT : Math.max(0, tapHit.point.y);
            const destination = projectToPlane(point, y);
            if (destination) {
              const adjusted = { ...destination, y: destination.y - importedOffsetRef.current };
              const projectAtTap = current.projectId;
              const timer = window.setTimeout(() => {
                if (pendingTapActionRef.current?.timer !== timer) return;
                pendingTapActionRef.current = null;
                previousPartTapRef.current = null;
                if (propsRef.current.projectId !== projectAtTap) return;
                updatePlacementPreview(destination);
                propsRef.current.onPlace(adjusted, undefined, placementOptions(destination));
              }, PART_TAP_ACTION_DELAY_MS);
              pendingTapActionRef.current = {
                timer, projectId: projectAtTap,
                action: () => {
                  updatePlacementPreview(destination);
                  propsRef.current.onPlace(adjusted, undefined, placementOptions(destination));
                },
              };
              suppressTapAction = true;
            }
          }
        }
      } else {
        previousEmptyTapRef.current = null;
        if (previousPartTapRef.current) {
          previousPartTapRef.current = null;
          flushPendingTap();
        }
      }
      if (current.onViewCameraChange && cameraInteractionStartRef.current && (click?.moved || cameraOnlyRef.current)) {
        const state = cameraStateRef.current, reference = cameraReferenceRef.current;
        const start = cameraInteractionStartRef.current;
        const rotated = !!start && (Math.abs(state.theta - start.theta) > 0.000001 || Math.abs(state.phi - start.phi) > 0.000001);
        const rotation = rotated
          ? instructionRotationFromCameraPose(state.theta, state.phi, current.viewRotation, reference.theta, reference.phi)
          : undefined;
        current.onViewCameraChange({
          theta: rotated ? reference.theta : state.theta,
          phi: rotated ? reference.phi : state.phi,
          distance: state.distance, target: state.target.toArray(),
          referenceDistance: reference.distance, referenceTarget: reference.target.toArray(),
        }, rotation);
        cameraInteractionStartRef.current = null;
      }
      if (!suppressTapAction && pointersRef.current.size === 1 && !cameraOnlyRef.current) {
        const drag = dragRef.current;
        if (drag?.pointerId === event.pointerId && drag.moved) {
          resolveDrag(drag);
          if (drag.destination) {
            const delta = {
              x: drag.destination.x - drag.origin.x,
              y: drag.destination.y - drag.origin.y,
              z: drag.destination.z - drag.origin.z,
            };
            const destination = { ...drag.destination, y: drag.destination.y - (drag.matrix ? importedOffsetRef.current : 0) };
            const changed = drag.members.length > 1
              ? Math.abs(delta.x) > 1e-10 || Math.abs(delta.y) > 1e-10 || Math.abs(delta.z) > 1e-10
              : drag.destination.x !== drag.origin.x || drag.destination.y !== drag.origin.y || drag.destination.z !== drag.origin.z ||
                !!drag.connection?.matrix.some((value, i) => value !== drag.matrix?.[i]);
            const transform = drag.connection?.matrix;
            const groupIds = drag.members.map(member => member.id);
            rollback();
            if (changed) {
              if (groupIds.length > 1 && current.onMoveGroup) current.onMoveGroup(groupIds, delta);
              else current.onMove(drag.id, destination, transform);
            }
          }
        } else if (current.toolMode === "build" && click) {
          const hit = findBrick(point);
          let destination: Position3 | null = null;
          if (hit) {
            const brick = current.bricks.find((item) => item.id === hit.id);
            const y = brick ? brick.y + BRICK_HEIGHT : Math.max(0, hit.point.y);
            destination = projectToPlane(point, y);
          } else {
            destination = projectToPlane(point, 0);
          }
          if (destination) {
            const transform = updatePlacementPreview(destination);
            current.onPlace({ ...destination, y: destination.y - importedOffsetRef.current }, transform, placementOptions(destination));
            placementLatch = undefined;
          }
        } else if (current.toolMode === "delete" && click && !click.moved) {
          const hit = findBrick(point);
          if (hit) current.onSelect(hit.id);
        } else if (current.toolMode === "select" && !drag && click && !click.moved) {
          const hit = findBrick(point);
          current.onSelect(hit?.id ?? null);
        } else if (
          current.toolMode === "view" &&
          autoSelectOnTapRef.current &&
          click &&
          !click.moved &&
          performance.now() - click.startedAt < VIEW_TAP_MAX_DURATION_MS
        ) {
          const hit = findBrick(point);
          if (hit) current.onViewPartTap?.(hit.id);
        }
      }

      pointersRef.current.delete(event.pointerId);
      pointerLastRef.current.delete(event.pointerId);
      clickRef.current = null;
      cameraInteractionStartRef.current = null;
      if (gesturePairRef.current?.includes(event.pointerId)) startGesture();
      if (pointersRef.current.size === 0) cameraOnlyRef.current = false;
      if (pointersRef.current.size === 0) dragRef.current = null;
      if (host.hasPointerCapture(event.pointerId)) {
        host.releasePointerCapture(event.pointerId);
      }
    };

    const onPointerCancel = (event: PointerEvent) => {
      // Releasing capture after a completed pointerup emits this too. That is
      // not a cancellation and must not clear newly verified committed ports.
      if (!pointersRef.current.has(event.pointerId) && dragRef.current?.pointerId !== event.pointerId) return;
      pointersRef.current.delete(event.pointerId);
      pointerLastRef.current.delete(event.pointerId);
      cameraInteractionStartRef.current = null;
      rollback();
      previousPartTapRef.current = null;
      previousEmptyTapRef.current = null;
      if (pendingTapActionRef.current) {
        window.clearTimeout(pendingTapActionRef.current.timer);
        pendingTapActionRef.current = null;
      }
      if (gesturePairRef.current?.includes(event.pointerId)) startGesture();
      if (pointersRef.current.size === 0) cameraOnlyRef.current = false;
      clickRef.current = null;
    };

    host.addEventListener("pointerdown", onPointerDown, { passive: false });
    host.addEventListener("pointermove", onPointerMove, { passive: false });
    host.addEventListener("pointerup", onPointerUp, { passive: false });
    host.addEventListener("pointercancel", onPointerCancel, { passive: false });
    host.addEventListener("lostpointercapture", onPointerCancel);
    const onBlur = () => {
      rollback(); pointersRef.current.clear(); pointerLastRef.current.clear();
      gestureStartRef.current = null; gesturePairRef.current = null; cameraOnlyRef.current = false;
      cameraInteractionStartRef.current = null;
      previousPartTapRef.current = null;
      previousEmptyTapRef.current = null;
      if (pendingTapActionRef.current) window.clearTimeout(pendingTapActionRef.current.timer);
      pendingTapActionRef.current = null;
    };
    window.addEventListener("blur", onBlur);
    return () => {
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerup", onPointerUp);
      host.removeEventListener("pointercancel", onPointerCancel);
      host.removeEventListener("lostpointercapture", onPointerCancel);
      window.removeEventListener("blur", onBlur);
      if (pendingTapActionRef.current) window.clearTimeout(pendingTapActionRef.current.timer);
      pendingTapActionRef.current = null;
      previousPartTapRef.current = null;
      rollback(); rollbackRef.current = null;
    };
  }, []);

  const compatibilityHint = rendererRef.current instanceof FallbackRenderer && bricks.length > 1200
    ? t("canvas.compatibilityLarge")
    : null;
  return <div ref={hostRef} className="builder-canvas" data-testid="canvas-3d" style={{ position: "relative" }}>
    <div ref={rotationAnchorMarkerRef} data-testid="rotation-anchor-marker" aria-hidden="true"
      style={{
        position: "absolute", left: 0, top: 0, zIndex: 5, display: "none",
        width: 20, height: 20, boxSizing: "border-box", borderRadius: "50%",
        border: "2px solid white", background: "rgba(228, 94, 50, 0.88)",
        boxShadow: "0 0 0 2px #9f3823", transform: "translate(-50%, -50%)",
        placeItems: "center", pointerEvents: "none",
      }}>
      <span style={{ width: 4, height: 4, borderRadius: "50%", background: "white" }} />
    </div>
    {toggleToast && <div role="status" className="canvas-toggle-toast" data-testid="construction-toggle-toast">{toggleToast}</div>}
    {showCollisions && showConstructionControls && toolMode !== "view" && <div role="status" className="canvas-collision-status" data-testid="collision-warning">
      {collisionState.pending ? <>
        {collisionState.progress?.phase === "snapshot" ? t("canvas.collisionPreparingModel")
          : collisionState.progress?.phase === "preparing" ? t("canvas.collisionPreparing") : t("canvas.collisionChecking")}
        {collisionState.progress && <> · {Math.floor(collisionState.progress.percent)} %</>}
        {collisionState.progress && <progress className="ml-2 h-2 w-20 align-middle" aria-label={t("canvas.collisionProgress")}
          max={100} value={collisionState.progress.percent} />}
        {!collisionState.progress && " …"}
      </> : collisionState.count
        ? t("canvas.colliding", { count: collisionState.count })
        : collisionState.failed ? t("canvas.collisionFailed")
        : collisionState.uncertain ? t("canvas.collisionUncertain")
        : t("canvas.noCollision")}
    </div>}
    {showFloating && floatingCount > 0 && <div role="status" aria-live="polite" data-testid="floating-warning"
      className="absolute left-2 right-2 top-2 z-10 rounded-lg border border-red-300 bg-red-50/95 p-3 text-xs text-red-900 shadow"
      style={{ pointerEvents: "none", top: sceneStatus || renderWarning || compatibilityHint ? 100 : 8 }}>
      <strong>{t(floatingCount === 1 ? "canvas.floatingOne" : "canvas.floatingMany", { count: floatingCount })}</strong>
      <p>{t("canvas.floatingInfo")}</p>
    </div>}
    {showConstructionControls && toolMode !== "view" && <div data-testid="construction-controls" className="absolute bottom-2 left-2 right-2 z-10 flex flex-wrap items-center gap-2 pointer-events-none">
      <button type="button" className="canvas-control-toggle pointer-events-auto rounded-xl border bg-white/95 px-3 py-3 text-xs font-semibold shadow-sm"
        aria-pressed={showConnections} aria-label={t("canvas.showConnections")}
        onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}
        title={t(showConnections ? "canvas.connectionsOn" : "canvas.connectionsOff")}
        onClick={() => { setShowConnections(!showConnections); setToggleToast(t(showConnections ? "canvas.connectionsOff" : "canvas.connectionsOn")); }}>
        <Link2 size={20} aria-hidden="true" />
      </button>
      <button type="button" className="canvas-control-toggle pointer-events-auto rounded-xl border bg-white/95 px-3 py-3 text-xs font-semibold shadow-sm"
        aria-pressed={showCollisions} aria-label={t("canvas.showCollisionWarning")}
        onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}
        title={t(showCollisions ? "canvas.collisionOn" : "canvas.collisionOff")}
        onClick={() => { setShowCollisions(!showCollisions); setToggleToast(t(showCollisions ? "canvas.collisionOff" : "canvas.collisionOn")); }}>
        <TriangleAlert size={20} aria-hidden="true" />
      </button>
      <button type="button" className="canvas-control-toggle pointer-events-auto rounded-xl border bg-white/95 px-3 py-3 text-xs font-semibold shadow-sm"
        aria-pressed={showFloating} aria-label={t("canvas.showFloatingWarning")}
        onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}
        title={t(showFloating ? "canvas.floatingOn" : "canvas.floatingOff")}
        onClick={() => { setShowFloating(!showFloating); setToggleToast(t(showFloating ? "canvas.floatingOff" : "canvas.floatingOn")); }}>
        <Cloud size={20} aria-hidden="true" />
      </button>
      {toolMode === "build" && <button type="button" data-testid="button-auto-select-after-placement"
        className={`canvas-control-toggle view-tap-select-toggle pointer-events-auto min-h-[46px] min-w-[46px] rounded-xl border px-3 py-3 shadow-sm ${autoSelectAfterPlacement
          ? darkMode ? "border-orange-400 bg-stone-800 text-orange-300" : "border-orange-600 bg-white/95 text-orange-700"
          : darkMode ? "border-stone-600 bg-stone-800 text-stone-100" : "border-stone-200 bg-white/95 text-stone-800"}`}
        aria-label={t(autoSelectAfterPlacement ? "canvas.autoSelectAfterPlacementOn" : "canvas.autoSelectAfterPlacementOff")}
        aria-pressed={autoSelectAfterPlacement}
        title={t(autoSelectAfterPlacement ? "canvas.autoSelectAfterPlacementOn" : "canvas.autoSelectAfterPlacementOff")}
        onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}
        onClick={() => {
          setAutoSelectAfterPlacement(!autoSelectAfterPlacement);
          setToggleToast(t(autoSelectAfterPlacement ? "canvas.autoSelectAfterPlacementOff" : "canvas.autoSelectAfterPlacementOn"));
        }}>
        <MousePointer2 size={20} aria-hidden="true" />
      </button>}
      {toolMode === "select" && <button type="button" data-testid="button-move-connected-above"
        className="canvas-control-toggle pointer-events-auto min-h-[46px] min-w-[46px] rounded-xl border px-3 py-3 shadow-sm"
        aria-label={t("canvas.moveConnectedAbove")}
        aria-pressed={moveConnectedAbove}
        title={t(moveConnectedAbove ? "canvas.moveConnectedAboveOn" : "canvas.moveConnectedAboveOff")}
        onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}
        onClick={() => {
          setMoveConnectedAbove(!moveConnectedAbove);
          setToggleToast(t(moveConnectedAbove ? "canvas.moveConnectedAboveOff" : "canvas.moveConnectedAboveOn"));
        }}>
        <Layers size={20} aria-hidden="true" />
      </button>}
      {showConnections && connectionStatus && <span role="status" data-testid="connection-status" className="rounded-lg bg-white/95 px-2 py-2 text-xs shadow-sm">{connectionStatus}</span>}
    </div>}
    {toolMode === "view" && <div className="absolute bottom-2 left-2 z-10">
      <button type="button" data-testid="button-view-tap-select-toggle"
        className={`canvas-control-toggle view-tap-select-toggle min-h-[46px] min-w-[46px] rounded-xl border px-3 py-3 shadow-sm ${autoSelectOnTap
          ? darkMode ? "border-orange-400 bg-stone-800 text-orange-300" : "border-orange-600 bg-white/95 text-orange-700"
          : darkMode ? "border-stone-600 bg-stone-800 text-stone-100" : "border-stone-200 bg-white/95 text-stone-800"}`}
        aria-label={t(autoSelectOnTap ? "canvas.autoSelectOn" : "canvas.autoSelectOff")}
        aria-pressed={autoSelectOnTap}
        title={t(autoSelectOnTap ? "canvas.autoSelectOnTitle" : "canvas.autoSelectOffTitle")}
        onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}
        onClick={() => {
          setAutoSelectOnTap(!autoSelectOnTap);
          setToggleToast(t(autoSelectOnTap ? "canvas.tapToggleOff" : "canvas.tapToggleOn"));
        }}>
        <MousePointer2 size={20} aria-hidden="true" />
      </button>
    </div>}
    {(sceneStatus || renderWarning || compatibilityHint) && <div
      role="status"
      className="absolute left-2 right-2 top-2 z-10 rounded-lg bg-white/95 p-3 text-xs text-stone-700 shadow"
      style={{ pointerEvents: "none" }}
    >
      <p>{sceneStatus ?? renderWarning ?? compatibilityHint}</p>
      {sceneStatus ? <button type="button" className="mt-2 underline"
        style={{ pointerEvents: "auto" }}
        onPointerDown={event => event.stopPropagation()}
        onClick={() => {
          buildControllerRef.current?.abort();
          setSceneStatus(null);
          setRenderWarning(t("canvas.cancelled"));
        }}>{t("canvas.cancelBuild")}</button> : <button type="button" className="mt-2 underline"
          style={{ pointerEvents: "auto" }}
          onPointerDown={event => event.stopPropagation()}
          onClick={() => setBuildAttempt(value => value + 1)}>{t("canvas.retryRender")}</button>}
    </div>}
  </div>;
}

function geometryCacheHas(geometry: InstancedMesh["geometry"]): boolean {
  return [...geometryCache.values()].some((cached) => cached === geometry);
}

function disposeImported(root: Group): void {
  disposeImportedScene(root);
}

function setRendererSize(
  renderer: WebGLRenderer | FallbackRenderer,
  width: number,
  height: number,
): void {
  if (renderer instanceof WebGLRenderer) {
    renderer.setSize(width, height, false);
  } else {
    renderer.setSize(width, height);
  }
}

function disposeMaterial(material: Material | Material[]): void {
  if (Array.isArray(material)) {
    for (const item of material) item.dispose();
  } else {
    material.dispose();
  }
}

export default BuilderCanvas;
