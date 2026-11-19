import { useEffect, useRef, useState } from "react";
import {
  BoxGeometry,
  Box3,
  Box3Helper,
  BufferGeometry,
  Color,
  CylinderGeometry,
  EdgesGeometry,
  Group,
  InstancedMesh,
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
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  applyInstructionCameraRotation,
  DEFAULT_INSTRUCTION_PHI,
  DEFAULT_INSTRUCTION_THETA,
  instructionRotationFromCameraPose,
} from "./instruction-camera";
import { applyInstructionFocus, installInstructionFocus, instructionDisplayColor } from "./instruction-focus";
import { createImportedGroupAsync, disposeImportedScene, SceneBudgetExceeded } from "./imported-scene";
import { prepareGeometry } from "./prepare-geometry";
import { reuseGeometryCache } from "./ldraw-geometry";
import { importedSelectionBounds, pickSoftwareInstance } from "./imported-selection";
import { createSoftwareScene, updateSoftwareScene, previewSoftware, restoreSoftware, applySoftwareInstructionFocus, INTERACTIVE_TRIANGLE_BUDGET, type SoftwareScene } from "./software-scene";
import { InstanceIndex, instanceIndex } from "./instance-index";
import { activeConnections, magneticConstructionTransform, hasUsableConnections, previewConnections } from "../connections/engine";
import type { MagneticLatch } from "../connections/engine";
import { ConnectionOverlay } from "../connections/overlay";
import type { InstructionCamera } from "../instructions/types";
import { drawInstructionOutlines, groupInstructionHighlights, instructionHighlightOccurrences, instructionGroupBounds } from "../instructions/outlines";
import { floatingParts, legacyBrickBounds } from "./floating";
import { stackingBounds } from "./stacking";
import type { ConnectionTransform } from "../connections/types";
import { createBuilderLighting } from "./lighting";
import type { Affine, ImportedModel } from "../formats/types";
import { cameraGesture, type GestureStart, type PointerPoint } from "./camera-gesture";

import {
  BRICK_DEFINITIONS,
  BRICK_HEIGHT,
  type Brick,
  type BrickType,
  type Position3,
  type ToolMode,
} from "@/features/editor/model";
import { brickTransformMatrix } from "@/features/editor/brick-transform";
import { brickConstructionBounds, constructionArea, createStudGridGeometry, type ConstructionArea } from "./construction-floor";

interface BuilderCanvasProps {
  showConstructionControls?: boolean;
  darkMode?: boolean;
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
  selectedType: BrickType;
  selectedColor: string;
  toolMode: ToolMode;
  onPlace: (position: Position3) => void;
  onSelect: (id: string | null) => void;
  onMove: (id: string, position: Position3, transform?: Affine) => void;
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

class FallbackRenderer {
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
    if (imported) {
      const faces: { points: ProjectedPoint[]; depth: number; color: string; alpha: number; selected: boolean }[] = [];
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
            faces.push({ points, depth: points.reduce((s, p) => s + p.depth, 0) / 3, color, alpha: imported.alpha[triangle], selected: id === selectedId });
      }
      faces.sort((a, b) => b.depth - a.depth);
      for (const face of faces) {
        polygonPath(context, face.points);
        context.globalAlpha = face.alpha;
        context.fillStyle = face.color;
        context.fill();
        if (face.selected) {
          context.globalAlpha = 1;
          context.strokeStyle = "#e45e32"; context.lineWidth = 1.5; context.stroke();
        }
      }
      context.globalAlpha = 1;
    }

    const orderedBricks = [...bricks].sort(
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
      const corners = [
        [-definition.studsX / 2, -definition.studsZ / 2],
        [definition.studsX / 2, -definition.studsZ / 2],
        [definition.studsX / 2, definition.studsZ / 2],
        [-definition.studsX / 2, definition.studsZ / 2],
      ].map(([x, z]) => new Vector3(x, 0, z).applyMatrix4(transform));
      const bodyHeight = BRICK_HEIGHT - 0.08;
      const topWorld = [
        [-definition.studsX / 2, -definition.studsZ / 2],
        [definition.studsX / 2, -definition.studsZ / 2],
        [definition.studsX / 2, definition.studsZ / 2],
        [-definition.studsX / 2, definition.studsZ / 2],
      ].map(([x, z]) => new Vector3(x, bodyHeight, z).applyMatrix4(transform));
      const bottom = corners.map(point => project(point.x, point.y, point.z));
      const top = topWorld.map(point => project(point.x, point.y, point.z));
      const color = new Color(brick.color);
      if (instructionFocusIds !== undefined) instructionDisplayColor(color, instructionFocusIds.has(brick.id));
      const sideNormals = [
        new Vector3(0, 0, -1), new Vector3(1, 0, 0),
        new Vector3(0, 0, 1), new Vector3(-1, 0, 0),
      ];
      const visibleSides = sideNormals.map((normal, index) => {
        const worldNormal = normal.transformDirection(transform);
        const face = [
          bottom[index],
          bottom[(index + 1) % bottom.length],
          top[(index + 1) % top.length],
          top[index],
        ];
        const center = corners[index].clone().add(corners[(index + 1) % corners.length])
          .add(topWorld[(index + 1) % topWorld.length]).add(topWorld[index]).multiplyScalar(0.25);
        const towardCamera = worldNormal.dot(new Vector3().subVectors(camera.position, center));
        const centerDepth = face.reduce((sum, point) => sum + point.depth, 0) / face.length;
        return { face, towardCamera, centerDepth };
      })
        .filter(side => side.towardCamera > 0)
        .sort((first, second) => second.centerDepth - first.centerDepth);
      for (const [index, side] of visibleSides.entries()) {
        const shade = index === 0 ? 0.72 : 0.84;
        fillPolygon(context, side.face, color.clone().multiplyScalar(shade).getStyle(), "#7d453b");
      }
      fillPolygon(context, top, color.clone().lerp(new Color("#ffffff"), 0.12).getStyle(), "#75433a");

      for (let x = 0; x < definition.studsX; x += 1) {
        for (let z = 0; z < definition.studsZ; z += 1) {
          const localX = x - (definition.studsX - 1) / 2;
          const localZ = z - (definition.studsZ - 1) / 2;
          const world = new Vector3(localX, BRICK_HEIGHT, localZ).applyMatrix4(transform);
          const center = project(world.x, world.y, world.z);
          const radiusXPoint = new Vector3(localX + 0.22, BRICK_HEIGHT, localZ).applyMatrix4(transform);
          const radiusZPoint = new Vector3(localX, BRICK_HEIGHT, localZ + 0.22).applyMatrix4(transform);
          const projectedX = project(radiusXPoint.x, radiusXPoint.y, radiusXPoint.z);
          const projectedZ = project(radiusZPoint.x, radiusZPoint.y, radiusZPoint.z);
          const radiusX = Math.hypot(projectedX.x - center.x, projectedX.y - center.y);
          const radiusZ = Math.hypot(projectedZ.x - center.x, projectedZ.y - center.y);
          const radius = Math.max(1.6, Math.min(8, (radiusX + radiusZ) / 2));
          context.beginPath();
          context.ellipse(center.x, center.y, radius, Math.max(1.4, radius * 0.62), 0, 0, Math.PI * 2);
          context.fillStyle = color.clone().lerp(new Color("#ffffff"), 0.24).getStyle();
          context.fill();
          context.strokeStyle = color.clone().multiplyScalar(0.7).getStyle();
          context.lineWidth = 0.8;
          context.stroke();
        }
      }

      if (selectedId === brick.id) {
        const selectionTop = [
          [-definition.studsX / 2, -definition.studsZ / 2],
          [definition.studsX / 2, -definition.studsZ / 2],
          [definition.studsX / 2, definition.studsZ / 2],
          [-definition.studsX / 2, definition.studsZ / 2],
        ].map(([x, z]) => {
          const point = new Vector3(x, BRICK_HEIGHT + 0.18, z).applyMatrix4(transform);
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

const geometryCache = new Map<BrickType, ReturnType<typeof mergeGeometries>>();

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

  const definition = BRICK_DEFINITIONS[type];
  const bodyHeight = BRICK_HEIGHT - 0.08;
  const studHeight = 0.16;
  const pieces: BufferGeometry[] = [];
  const body = new BoxGeometry(
    definition.studsX - 0.035,
    bodyHeight,
    definition.studsZ - 0.035,
  );
  body.translate(0, bodyHeight / 2, 0);
  pieces.push(body);

  for (let x = 0; x < definition.studsX; x += 1) {
    for (let z = 0; z < definition.studsZ; z += 1) {
      const cylinder = new CylinderGeometry(0.27, 0.27, studHeight, 16);
      cylinder.translate(
        x - (definition.studsX - 1) / 2,
        bodyHeight + studHeight / 2,
        z - (definition.studsZ - 1) / 2,
      );
      pieces.push(cylinder);
    }
  }

  const merged = mergeGeometries(pieces, false);
  for (const piece of pieces) piece.dispose();
  if (!merged) throw new Error(`Could not build geometry for ${type}.`);
  merged.computeVertexNormals();
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

function softwareWarning(scene: SoftwareScene): string {
  const samples = scene.triangleCount - scene.free.length;
  return `Kompatibilitätsansicht ohne WebGL: ${samples.toLocaleString("de-DE")} von ${scene.sourceTriangles.toLocaleString("de-DE")} Dreiecken. Während der Bewegung sind Details reduziert; alle Projektdaten bleiben erhalten.`;
}

export function BuilderCanvas({
  showConstructionControls = true,
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
  selectedType,
  selectedColor,
  toolMode,
  onPlace,
  onSelect,
  onMove,
}: BuilderCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const cameraRef = useRef<PerspectiveCamera | null>(null);
  const rendererRef = useRef<WebGLRenderer | FallbackRenderer | null>(null);
  const brickRootRef = useRef<Group | null>(null);
  const importedRootRef = useRef<Group | null>(null);
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
  const [renderWarning, setRenderWarning] = useState<string | null>(null);
  const [buildAttempt, setBuildAttempt] = useState(0);
  const [forceCompatibility, setForceCompatibility] = useState(false);
  const pendingPreviewRef = useRef<(() => void) | null>(null);
  const rollbackRef = useRef<(() => void) | null>(null);
  const previewBrickRef = useRef<Brick | null>(null);
  const attemptRef = useRef(-1);
  const overlayRef = useRef<ConnectionOverlay | null>(null);
  const [showConnections, setShowConnections] = useState(true);
  const showConnectionsRef = useRef(true);
  showConnectionsRef.current = showConnections;
  const [showConnectionPreview, setShowConnectionPreview] = useState(false);
  const showConnectionPreviewRef = useRef(false);
  showConnectionPreviewRef.current = showConnectionPreview;
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
    setConnectionStatus(overlay.contacts.length ? `${overlay.contacts.length} geprüfte Verbindung${overlay.contacts.length === 1 ? "" : "en"}` :
      instance && model ? hasUsableConnections(model, instance.id) ? "Keine aktive Verbindung" : "Keine nutzbaren Verbindungsdaten · freie Platzierung" : "");
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
    viewRotation,
    viewCamera, onViewCameraChange,
    instructionFocusIds,
    projectId,
    bricks,
    imported,
    selectedId,
    selectedType,
    selectedColor,
    toolMode,
    onPlace,
    onSelect,
    onMove,
  });
  const pointersRef = useRef(new Map<number, PointerPoint>());
  const pointerLastRef = useRef(new Map<number, PointerPoint>());
  const gestureStartRef = useRef<GestureStart | null>(null);
  const gesturePairRef = useRef<readonly [number, number] | null>(null);
  const cameraOnlyRef = useRef(false);
  const cameraInteractionStartRef = useRef<{ theta: number; phi: number } | null>(null);
  const dragRef = useRef<DragCandidate | null>(null);
  const clickRef = useRef<{ id: number; start: PointerPoint; moved: boolean } | null>(
    null,
  );
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
    viewRotation,
    viewCamera, onViewCameraChange,
    instructionFocusIds,
    projectId,
    bricks,
    imported,
    selectedId,
    selectedType,
    selectedColor,
    toolMode,
    onPlace,
    onSelect,
    onMove,
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
          importedRootRef.current?.children.forEach(child => {
            if (child.name === "ldraw:instanced-edges") child.visible = !interactive;
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
          );
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
    invalidatorRef.current?.();
  }, [viewRotation?.[0], viewRotation?.[1], viewRotation?.[2]]);

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
          if (software) setRenderWarning(softwareWarning(software));
          updateImportedSelection();
          refreshConnections();
          return;
        }
      } catch (error) {
        setRenderWarning(`Darstellung konnte nicht aktualisiert werden: ${error instanceof Error ? error.message : String(error)}. Die bisherige Ansicht bleibt erhalten.`);
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
          setRenderWarning(softwareWarning(softwareSceneRef.current));
          invalidatorRef.current?.(); return;
        }
      } catch (error) { setRenderWarning(`Kompatibilitätsansicht konnte nicht aktualisiert werden: ${String(error)}`); return; }
    }
    const controller = new AbortController();
    buildControllerRef.current = controller;
    setRenderWarning(null);
    setSceneStatus(imported ? "3D-Modell wird vorbereitet …" : null);
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
      const progress = (stage: string) => (completed: number, total: number) => {
        if (controller.signal.aborted || performance.now() - lastProgress < 80) return;
        lastProgress = performance.now();
        setSceneStatus(`${stage}: ${completed} / ${total}`);
      };
      await prepareGeometry(imported, { signal: controller.signal, onProgress: progress("Geometrie") });
      let root: Group | null = null, bounds: Box3;
      let software: SoftwareScene | undefined;
      if (rendererRef.current instanceof WebGLRenderer && !forceCompatibility) {
        try {
          const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
          const maxGeometryBytes = (memory <= 1 ? 32 : memory <= 2 ? 64 : 96) * 1024 * 1024;
          root = await createImportedGroupAsync(imported, {
            signal: controller.signal, onProgress: progress("3D-Szene"), maxGeometryBytes,
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
        software = await createSoftwareScene(imported, { signal: controller.signal, onProgress: progress("Kompatibilitätsansicht") });
        controller.signal.throwIfAborted();
        if (rendererRef.current instanceof WebGLRenderer) {
          const previousRenderer = rendererRef.current;
          previousRenderer.dispose();
          previousRenderer.domElement.remove();
          const fallback = new FallbackRenderer();
          fallback.domElement.className = "builder-webgl-canvas";
          fallback.domElement.setAttribute("data-renderer", "canvas-fallback");
          fallback.domElement.setAttribute("aria-label", "3D-Kompatibilitätsansicht");
          fallback.domElement.style.touchAction = "none";
          const rectangle = hostRef.current!.getBoundingClientRect();
          fallback.setSize(rectangle.width, rectangle.height);
          hostRef.current!.appendChild(fallback.domElement);
          rendererRef.current = fallback;
        }
        bounds = software.bounds.clone();
        setRenderWarning(softwareWarning(software));
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
      setRenderWarning(`3D-Aufbau fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}. Projektdaten bleiben erhalten.`);
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
    if (!showConnectionPreview && overlayRef.current) overlayRef.current.previews = [];
    invalidatorRef.current?.();
  }, [showConnectionPreview]);

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

    const dummy = new Object3D();
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
        dummy.position.set(brick.x, brick.y, brick.z);
        dummy.rotation.set(
          (brick.tiltX ?? 0) * Math.PI / 180,
          brick.rotation * Math.PI / 180,
          (brick.tiltZ ?? 0) * Math.PI / 180,
          "XYZ",
        );
        dummy.updateMatrix();
        instances.setMatrixAt(index, dummy.matrix);
      });
      instances.instanceMatrix.needsUpdate = true;
      nextRoot.add(instances);
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

    const rollback = () => {
      pendingPreviewRef.current = null;
      const drag = dragRef.current;
      if (drag) {
        if (importedRootRef.current) instanceIndex(importedRootRef.current)?.restore(drag.id);
        if (softwareSceneRef.current) restoreSoftware(softwareSceneRef.current, drag.id);
        const brick = propsRef.current.bricks.find(value => value.id === drag.id);
        if (brick) applyBrickPreview(brick);
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
        } else if (child.userData.isSelectionOutline) {
          child.position.set(brick.x, brick.y, brick.z);
          child.rotation.set((brick.tiltX ?? 0) * Math.PI / 180, brick.rotation * Math.PI / 180, (brick.tiltZ ?? 0) * Math.PI / 180, "XYZ");
        }
      }
    };
    const resolveDrag = (drag: DragCandidate) => {
      if (!drag.destination || !drag.needsSnap) return;
      if (drag.matrix && propsRef.current.imported) {
        const offset = importedOffsetRef.current;
        const requested = { ...drag.destination, y: drag.destination.y - offset };
        const magnetic = magneticConstructionTransform(propsRef.current.imported, drag.id,
          requested, drag.magneticLatch);
        drag.magneticLatch = magnetic.latch;
        const result = magnetic.transform;
        drag.connection = result;
        const suggestions = !showConnectionPreviewRef.current || !showConnectionsRef.current
          ? [] : previewConnections(propsRef.current.imported, drag.id, requested).filter(suggestion =>
            !result.contacts.some(contact => contact.targetId === suggestion.targetId &&
              contact.targetConnectorId === suggestion.targetConnectorId &&
              contact.movingConnectorId === suggestion.movingConnectorId));
        if (overlayRef.current) {
          overlayRef.current.contacts = result.contacts;
          overlayRef.current.previews = suggestions;
        }
        setConnectionStatus(result.status === "candidate" && result.contacts.length
          ? `Magnetisch eingerastet · ${result.contacts.length} Verbindung${result.contacts.length === 1 ? "" : "en"} · zum Lösen weiterziehen${suggestions.length ? ` · ${suggestions.length} weitere Vorschläge` : ""}` :
          suggestions.length ? `${suggestions.length} passende Verbindung${suggestions.length === 1 ? "" : "en"} in Reichweite · noch nicht eingerastet` :
          result.status === "candidate" ? `Magnetisch eingerastet · ${result.contacts.length} Verbindung${result.contacts.length === 1 ? "" : "en"} · zum Lösen weiterziehen` :
          result.status === "no-data" ? "Keine nutzbaren Verbindungsdaten · freie Platzierung" : "Keine passende Verbindung · freie Platzierung");
        const position = { x: result.matrix[3] / 20, y: -result.matrix[7] / 20, z: result.matrix[11] / 20 };
        drag.destination = { ...position, y: position.y + offset };
      } else {
        drag.destination.x = Math.round(drag.destination.x * 2) / 2;
        drag.destination.z = Math.round(drag.destination.z * 2) / 2;
      }
      drag.needsSnap = false;
    };
    const queuePreview = (drag: DragCandidate) => {
      pendingPreviewRef.current = () => {
        if (dragRef.current !== drag || !drag.destination) return;
        resolveDrag(drag);
        const position = drag.destination;
        if (drag.matrix) {
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
        if (drag.matrix) {
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
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest("button")) return;
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
      clickRef.current = { id: event.pointerId, start: point, moved: false };
      const current = propsRef.current;
      const hit = current.toolMode === "view" ? null : findBrick(point);
      if (current.toolMode === "select") {
        if (hit) {
          current.onSelect(hit.id);
          const brick = current.bricks.find((item) => item.id === hit.id);
          const instance = current.imported?.instances.find(item => item.id === hit.id);
          const origin = brick ? { x: brick.x, y: brick.y, z: brick.z } :
            instance ? { x: instance.matrix[3] / 20, y: -instance.matrix[7] / 20 + importedOffsetRef.current, z: instance.matrix[11] / 20 } : null;
          if (origin) {
            dragRef.current = {
              id: hit.id,
              pointerId: event.pointerId,
              start: point,
              origin,
              moved: false,
              destination: null,
              matrix: instance?.matrix,
              planeStart: projectToPlane(point, origin.y),
            };
          }
        } else {
          dragRef.current = null;
        }
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!pointersRef.current.has(event.pointerId)) return;
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

      const start = dragRef.current;
      const click = clickRef.current;
      if (
        click?.id === event.pointerId &&
        Math.hypot(event.clientX - click.start.x, event.clientY - click.start.y) > 5
      ) {
        click.moved = true;
      }
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
            start.needsSnap = true;
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
      if (pointersRef.current.size === 1 && !cameraOnlyRef.current) {
        const drag = dragRef.current;
        if (drag?.pointerId === event.pointerId && drag.moved) {
          resolveDrag(drag);
          if (drag.destination) {
            const destination = { ...drag.destination, y: drag.destination.y - (drag.matrix ? importedOffsetRef.current : 0) };
            const changed = drag.destination.x !== drag.origin.x || drag.destination.y !== drag.origin.y || drag.destination.z !== drag.origin.z ||
              !!drag.connection?.matrix.some((value, i) => value !== drag.matrix?.[i]);
            const transform = drag.connection?.matrix;
            rollback();
            if (changed) current.onMove(drag.id, destination, transform);
          }
        } else if (current.toolMode === "build" && click && !click.moved) {
          const hit = findBrick(point);
          let destination: Position3 | null = null;
          if (hit) {
            const brick = current.bricks.find((item) => item.id === hit.id);
            const y = brick ? brick.y + BRICK_HEIGHT : Math.max(0, hit.point.y);
            destination = projectToPlane(point, y);
          } else {
            destination = projectToPlane(point, 0);
          }
          if (destination) current.onPlace({ ...destination, y: destination.y - importedOffsetRef.current });
        } else if (current.toolMode === "delete" && click && !click.moved) {
          const hit = findBrick(point);
          if (hit) current.onSelect(hit.id);
        } else if (current.toolMode === "select" && !drag && click && !click.moved) {
          const hit = findBrick(point);
          current.onSelect(hit?.id ?? null);
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
    };
    window.addEventListener("blur", onBlur);
    return () => {
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerup", onPointerUp);
      host.removeEventListener("pointercancel", onPointerCancel);
      host.removeEventListener("lostpointercapture", onPointerCancel);
      window.removeEventListener("blur", onBlur);
      rollback(); rollbackRef.current = null;
    };
  }, []);

  const compatibilityHint = rendererRef.current instanceof FallbackRenderer && bricks.length > 1200
    ? "Kompatibilitätsansicht ohne WebGL: begrenzte Details bei großen Projekten; alle Steine bleiben gespeichert."
    : null;
  return <div ref={hostRef} className="builder-canvas" data-testid="canvas-3d" style={{ position: "relative" }}>
    {showFloating && floatingCount > 0 && <div role="status" aria-live="polite" data-testid="floating-warning"
      className="absolute left-2 right-2 top-2 z-10 rounded-lg border border-red-300 bg-red-50/95 p-3 text-xs text-red-900 shadow"
      style={{ pointerEvents: "none", top: sceneStatus || renderWarning || compatibilityHint ? 100 : 8 }}>
      <strong>{floatingCount} {floatingCount === 1 ? "Teil schwebt möglicherweise" : "Teile schweben möglicherweise"} · rot markiert</strong>
      <p>Keine geometrische Verbindung zum Boden gefunden. Kontaktprüfung anhand der Geometriegrenzen, keine Statikprüfung.</p>
    </div>}
    {showConstructionControls && <div data-testid="construction-controls" className="absolute bottom-2 left-2 right-2 z-10 flex flex-wrap items-center gap-2 pointer-events-none">
      <button type="button" className="pointer-events-auto rounded-xl border bg-white/95 px-3 py-3 text-xs font-semibold shadow-sm"
        aria-pressed={showConnections} aria-label="Verbindungen anzeigen"
        onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}
        onClick={() => setShowConnections(value => !value)}>
        Verbindungen {showConnections ? "an" : "aus"}
      </button>
      <button type="button" className="pointer-events-auto rounded-xl border bg-white/95 px-3 py-3 text-xs font-semibold shadow-sm"
        aria-pressed={showConnectionPreview} aria-label="Verbindungsvorschau anzeigen"
        onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}
        onClick={() => setShowConnectionPreview(value => !value)}>
        Vorschläge {showConnectionPreview ? "an" : "aus"}
      </button>
      <button type="button" className="pointer-events-auto rounded-xl border bg-white/95 px-3 py-3 text-xs font-semibold shadow-sm"
        aria-pressed={showFloating} aria-label="Schwebewarnung anzeigen"
        onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}
        onClick={() => setShowFloating(value => !value)}>
        Schwebewarnung {showFloating ? "an" : "aus"}
      </button>
      {showConnections && connectionStatus && <span role="status" data-testid="connection-status" className="rounded-lg bg-white/95 px-2 py-2 text-xs shadow-sm">{connectionStatus}</span>}
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
          setRenderWarning("3D-Aufbau abgebrochen. Das Projekt bleibt unverändert gespeichert.");
        }}>Vorbereitung abbrechen</button> : <button type="button" className="mt-2 underline"
          style={{ pointerEvents: "auto" }}
          onPointerDown={event => event.stopPropagation()}
          onClick={() => setBuildAttempt(value => value + 1)}>Darstellung neu aufbauen</button>}
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
