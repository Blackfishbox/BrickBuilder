import {
  AmbientLight, Box3, BufferGeometry, Color, DirectionalLight,
  Group, InstancedBufferAttribute, InstancedBufferGeometry, InstancedMesh, Matrix4,
  Mesh, LineSegments, MeshBasicMaterial, MeshLambertMaterial, DoubleSide, OrthographicCamera, Scene, ShaderMaterial, Vector3, WebGLRenderer,
} from "three";
import type { BrickType, BuilderDocument } from "../editor/model";
import { brickTransformMatrix } from "../editor/brick-transform";
import { createLocalBrickGeometry } from "../engine/local-brick-geometry";
import { createLocalBrickEdgeBatches } from "../engine/local-brick-edge-batches";
import { createImportedGroupAsync, disposeImportedScene } from "../engine/imported-scene";
import { NORMAL_EDGE_CONTRAST, setWideLineResolution } from "../engine/wide-lines";
import type { InstructionStep } from "./types";
import { createSoftwareInstructionRenderer, INSTRUCTION_RENDER_SIZE } from "./software-render";
import { instructionDisplayColor } from "./highlight-color";
import { drawInstructionOutlines, groupInstructionHighlights, instructionHighlightOccurrences, instructionGroupFrames } from "./outlines";
import { applyPdfStepCamera, fitStudioCamera, setPdfDefaultCamera, studioRenderSize } from "./camera";
import { drawStudioModelArrows, studioModelArrowPoints, type StudioModelArrow } from "./studio-objects";
import { drawHighlightSilhouette } from "./silhouette";
import { configureStudioEdges } from "./studio-edges";
import { INSTRUCTION_LIGHTING } from "../engine/lighting";
import { releaseBetweenInstructionImages } from "./image-resources";
import { projectInstructionPartBounds, type ProjectedPartBounds } from "./part-projection";

const FOCUS_ATTRIBUTE = "instructionFocus";
export const INSTRUCTION_PDF_EDGE_WIDTH_PX = 4;
const FOCUS_VERTEX_HEADER = "attribute float instructionFocus;\nvarying float vInstructionFocus;\n";
const FOCUS_FRAGMENT_HEADER = "varying float vInstructionFocus;\n";
const FOCUS_VERTEX = "vInstructionFocus = instructionFocus;";
const FOCUS_FRAGMENT = `
  if (vInstructionFocus > 0.5 && vInstructionFocus < 1.5) {
    gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0), 0.1);
  } else if (vInstructionFocus > 1.5) {
    // Red bounds are composited separately; keep the source color.
  }
`;

function instructionFocusAttribute(mesh: InstancedMesh): InstancedBufferAttribute {
  let attribute = mesh.geometry.getAttribute(FOCUS_ATTRIBUTE) as InstancedBufferAttribute | undefined;
  if (attribute) return attribute;
  attribute = new InstancedBufferAttribute(new Float32Array(mesh.count), 1);
  mesh.geometry.setAttribute(FOCUS_ATTRIBUTE, attribute);
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of materials) {
    const compile = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      compile.call(material, shader, renderer);
      shader.vertexShader = FOCUS_VERTEX_HEADER + shader.vertexShader.replace(
        "#include <begin_vertex>", `#include <begin_vertex>\n${FOCUS_VERTEX}`,
      );
      shader.fragmentShader = FOCUS_FRAGMENT_HEADER + shader.fragmentShader.replace(
        "#include <colorspace_fragment>", `${FOCUS_FRAGMENT}\n#include <colorspace_fragment>`,
      );
    };
    const cacheKey = material.customProgramCacheKey.bind(material);
    material.customProgramCacheKey = () => `${cacheKey()}|instruction-focus-v1`;
  }
  return attribute;
}

function applyPdfInstructionFocus(root: Group | undefined, highlightIds?: ReadonlySet<string>): void {
  root?.traverse(object => {
    if (!(object instanceof InstancedMesh)) return;
    const ids = object.userData.brickIds as string[] | undefined;
    if (!ids) return;
    const attribute = instructionFocusAttribute(object);
    ids.forEach((id, index) => attribute.setX(index, highlightIds === undefined ? 0 : highlightIds.has(id) ? 2 : 1));
    attribute.needsUpdate = true;
  });
}

/** LDraw edge quads are expanded in screen space and need the actual render size. */
function configureInstructionEdges(root: Group, width: number, height: number): void {
  root.traverse(object => {
    if (!(object instanceof Mesh) || !object.userData.isWideEdgeMesh ||
      !(object.material instanceof ShaderMaterial)) return;
    object.material.uniforms.lineWidth.value = INSTRUCTION_PDF_EDGE_WIDTH_PX;
    object.material.uniforms.edgeContrast.value = NORMAL_EDGE_CONTRAST;
    setWideLineResolution(object.material, width, height);
  });
}

export interface InstructionImageStyle {
  onPartBounds?: (bounds: ProjectedPartBounds) => void;
  preserveColors?: boolean;
  silhouetteHighlight?: boolean;
  studioEdges?: boolean;
  transparentBackground?: boolean;
}
export interface InstructionImageRenderer {
  image(visible: Set<string>, step: InstructionStep, highlightIds?: ReadonlySet<string>, fitAspect?: number,
    modelArrows?: readonly StudioModelArrow[], minimumFrameHeight?: number, style?: InstructionImageStyle): string;
  imageAsync?(...args: Parameters<InstructionImageRenderer["image"]>): Promise<string>;
  dispose(): void;
}

/** Await recovery when supported, while retaining injectable synchronous renderers. */
export async function renderInstructionImage(
  renderer: InstructionImageRenderer, ...args: Parameters<InstructionImageRenderer["image"]>
): Promise<string> {
  return renderer.imageAsync ? renderer.imageAsync(...args) : renderer.image(...args);
}

/** One reusable, bounded WebGL context for the entire PDF, not one scene per page. */
export async function createInstructionRenderer(document: BuilderDocument, signal?: AbortSignal,
  options: { requireWebGL?: boolean } = {}): Promise<InstructionImageRenderer> {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
  } catch (error) {
    if (options.requireWebGL) {
      throw Object.assign(new Error("PDF_WEBGL_CONTEXT_LOST", { cause: error }), { code: "PDF_WEBGL_CONTEXT_LOST" });
    }
    return createSoftwareInstructionRenderer(document, signal);
  }
  renderer.setPixelRatio(1);
  renderer.setSize(INSTRUCTION_RENDER_SIZE.width, INSTRUCTION_RENDER_SIZE.height);
  renderer.setClearColor("#ffffff");
  const scene = new Scene(), pivot = new Group(), assembly = new Group();
  scene.add(pivot); pivot.add(assembly);
  scene.add(new AmbientLight(0xffffff, INSTRUCTION_LIGHTING.ambient));
  const light = new DirectionalLight(0xffffff, INSTRUCTION_LIGHTING.sun);
  light.position.set(10, 18, 12); scene.add(light);
  const camera = new OrthographicCamera(-10, 10, 7.6, -7.6, 0.01, 100000);
  let imported: Group | undefined;
  const brickColors = new Map<string, Color>();
  const brickMaterials = new Map<string, MeshLambertMaterial>();
  // Geometry is immutable and export-owned; materials remain occurrence-specific.
  const brickGeometries = new Map<BrickType, BufferGeometry>();
  const localEdgeBatches: Mesh[] = [];
  const output = globalThis.document.createElement("canvas");
  output.width = INSTRUCTION_RENDER_SIZE.width; output.height = INSTRUCTION_RENDER_SIZE.height;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (imported) disposeImportedScene(imported);
    for (const geometry of brickGeometries.values()) geometry.dispose();
    for (const material of brickMaterials.values()) material.dispose();
    for (const batch of localEdgeBatches) {
      batch.geometry.dispose();
      for (const material of Array.isArray(batch.material) ? batch.material : [batch.material]) material.dispose();
    }
    brickGeometries.clear(); brickMaterials.clear(); brickColors.clear();
    localEdgeBatches.length = 0;
    renderer.dispose(); renderer.forceContextLoss();
    output.width = 1; output.height = 1;
  };
  try {
    if (document.imported) {
      imported = await createImportedGroupAsync(document.imported, { signal, instruction: true });
      assembly.add(imported);
    }
    const bounds = imported ? new Box3().setFromObject(imported) : new Box3();
    for (const part of document.bricks) {
      const group = new Group();
      group.userData.partId = part.id;
      const material = new MeshLambertMaterial({ color: new Color(part.color) });
      brickColors.set(part.id, material.color.clone());
      brickMaterials.set(part.id, material);
      let geometry = brickGeometries.get(part.type);
      if (!geometry) {
        geometry = createLocalBrickGeometry(part.type);
        brickGeometries.set(part.type, geometry);
      }
      group.add(new Mesh(geometry, material));
      group.applyMatrix4(brickTransformMatrix(part));
      assembly.add(group);
      // A rotated bounding box includes empty space above the body beside the
      // studs. Use actual local vertices, as the software renderer does.
      bounds.expandByObject(group, true);
    }
    localEdgeBatches.push(...createLocalBrickEdgeBatches(document.bricks));
    for (const edgeBatch of localEdgeBatches) assembly.add(edgeBatch);
    configureInstructionEdges(assembly, INSTRUCTION_RENDER_SIZE.width, INSTRUCTION_RENDER_SIZE.height);
    const center = bounds.isEmpty() ? new Vector3() : bounds.getCenter(new Vector3());
    const radius = bounds.isEmpty() ? 2 : Math.max(1, bounds.getSize(new Vector3()).length() / 2);
    assembly.position.sub(center);
    const aspect = INSTRUCTION_RENDER_SIZE.width / INSTRUCTION_RENDER_SIZE.height;
    camera.left = -radius * 1.12 * aspect; camera.right = -camera.left;
    camera.top = radius * 1.12; camera.bottom = -camera.top;
    camera.far = Math.max(100, radius * 12);
    setPdfDefaultCamera(camera, radius);
    const matrices = new Map<InstancedMesh, Float32Array>();
    const rows = new Map<InstancedBufferGeometry, Float32Array[]>();
    assembly.traverse(object => {
      if (object instanceof InstancedMesh) matrices.set(object, new Float32Array(object.instanceMatrix.array));
      const geometry = (object as Mesh).geometry;
      if (geometry instanceof InstancedBufferGeometry && geometry.getAttribute("instanceRow0")) {
        rows.set(geometry, [0, 1, 2].map(index => new Float32Array(geometry.getAttribute(`instanceRow${index}`).array)));
      }
    });
    const zero = new Matrix4().makeScale(0, 0, 0), matrix = new Matrix4();
    const highlightOccurrences = instructionHighlightOccurrences(document.bricks, document.imported);
    const images: InstructionImageRenderer = {
      image(visible, step, highlightIds, fitAspect, modelArrows = [], minimumFrameHeight, style) {
        signal?.throwIfAborted();
        const checkContext = () => {
          if (renderer.getContext?.()?.isContextLost?.()) {
            throw Object.assign(new Error("PDF_WEBGL_CONTEXT_LOST"), { code: "PDF_WEBGL_CONTEXT_LOST" });
          }
        };
        checkContext();
        renderer.setClearColor(0xffffff, style?.transparentBackground ? 0 : 1);
        const rotation = step.rotation ?? [0, 0, 0];
        pivot.rotation.set(...rotation.map(angle => angle * Math.PI / 180) as [number, number, number]);
        const renderSize = fitAspect ? studioRenderSize(fitAspect) : INSTRUCTION_RENDER_SIZE;
        if (output.width !== renderSize.width || output.height !== renderSize.height) {
          renderer.setSize(renderSize.width, renderSize.height);
          output.width = renderSize.width; output.height = renderSize.height;
        }
        configureInstructionEdges(assembly, renderSize.width, renderSize.height);
        configureStudioEdges(assembly, renderSize.width, renderSize.height, style?.studioEdges ?? false);
        camera.left = -radius * 1.12 * aspect; camera.right = -camera.left;
        camera.top = radius * 1.12; camera.bottom = -camera.top;
        applyPdfStepCamera(camera, radius, step.camera);
        for (const [id, material] of brickMaterials) {
          material.color.copy(brickColors.get(id)!);
          if (highlightIds !== undefined && !style?.preserveColors) instructionDisplayColor(material.color, highlightIds.has(id));
        }
        applyPdfInstructionFocus(imported, style?.preserveColors ? undefined : highlightIds);
        const applyVisibility = (visible: ReadonlySet<string>) => assembly.traverse(object => {
          if (object.userData.partId) object.visible = visible.has(object.userData.partId as string);
          const ids = object.userData.brickIds as string[] | undefined;
          if (!ids) return;
          if (object instanceof InstancedMesh) {
            const source = matrices.get(object)!;
            ids.forEach((id, index) => object.setMatrixAt(index, visible.has(id) ? matrix.fromArray(source, index * 16) : zero));
            object.instanceMatrix.needsUpdate = true;
          }
          const geometry = (object as Mesh).geometry;
          if (geometry instanceof InstancedBufferGeometry && rows.has(geometry)) {
            const source = rows.get(geometry)!;
            for (let row = 0; row < 3; row++) {
              const attribute = geometry.getAttribute(`instanceRow${row}`) as InstancedBufferAttribute;
              ids.forEach((id, index) => {
                for (let component = 0; component < 4; component++) {
                  attribute.array[index * 4 + component] = visible.has(id) ? source[row][index * 4 + component] : 0;
                }
              });
              attribute.needsUpdate = true;
            }
          }
        });
        applyVisibility(visible);
        if (fitAspect) {
          scene.updateMatrixWorld(true);
          const fitBounds = new Box3(), point = new Vector3(), world = new Matrix4();
          const partBounds = new Map<string, Box3>();
          assembly.traverseVisible(object => {
            if (!(object instanceof Mesh) || object.userData.isWideEdgeMesh) return;
            const positions = object.geometry.getAttribute("position");
            if (!positions) return;
            const ids = object.userData.brickIds as string[] | undefined;
            const count = object instanceof InstancedMesh ? object.count : 1;
            for (let instance = 0; instance < count; instance++) {
              if (ids && !visible.has(ids[instance])) continue;
              let partId = ids?.[instance] ?? object.userData.partId as string | undefined;
              for (let parent = object.parent; !partId && parent; parent = parent.parent) {
                partId = parent.userData.partId as string | undefined;
              }
              const box = style?.onPartBounds && partId
                ? partBounds.get(partId) ?? new Box3() : undefined;
              if (box && partId) partBounds.set(partId, box);
              world.copy(object.matrixWorld);
              if (object instanceof InstancedMesh) {
                object.getMatrixAt(instance, matrix);
                world.multiply(matrix);
              }
              world.premultiply(camera.matrixWorldInverse);
              for (let index = 0; index < positions.count; index++) {
                fitBounds.expandByPoint(point.fromBufferAttribute(positions, index).applyMatrix4(world));
                box?.expandByPoint(point);
              }
            }
          });
          // Stale/off-frame source annotations must not shrink the model to a
          // dot. Frame surfaces first; arrows are clipped to that same view.
          for (const arrowPoint of fitBounds.isEmpty() ? studioModelArrowPoints(modelArrows, center, rotation) : []) {
            fitBounds.expandByPoint(arrowPoint.applyMatrix4(camera.matrixWorldInverse));
          }
          fitStudioCamera(camera, fitBounds, renderSize.width / renderSize.height, minimumFrameHeight);
          style?.onPartBounds?.(projectInstructionPartBounds(partBounds, camera));
        }
        renderer.render(scene, camera);
        checkContext();
        const context = output.getContext("2d");
        if (!context) throw new Error("PDF-Bild konnte nicht zusammengesetzt werden.");
        context.globalCompositeOperation = "copy";
        context.drawImage(renderer.domElement, 0, 0);
        context.globalCompositeOperation = "source-over";
        if (modelArrows.length) {
          drawStudioModelArrows(context, camera, modelArrows, center, rotation, renderSize.width, renderSize.height);
        }
        if (highlightIds?.size && style?.silhouetteHighlight) {
          const maskMaterial = new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide });
          const edges: (Mesh | LineSegments)[] = [];
          const selected = new Set([...highlightIds].filter(id => visible.has(id)));
          try {
            applyVisibility(selected);
            assembly.traverse(object => {
              // Compact edges are LineSegments with shader-only instance
              // transforms. A generic mask material cannot transform them.
              // The mask must contain surfaces only, for every edge backend.
              if ((object instanceof LineSegments ||
                (object instanceof Mesh && object.userData.isWideEdgeMesh)) && object.visible) {
                edges.push(object); object.visible = false;
              }
            });
            scene.overrideMaterial = maskMaterial;
            renderer.setClearColor(0xffffff, 0);
            renderer.render(scene, camera);
            checkContext();
            drawHighlightSilhouette(context, renderer.domElement, renderSize.width, renderSize.height);
          } finally {
            scene.overrideMaterial = null;
            renderer.setClearColor(0xffffff, 1);
            edges.forEach(edge => { edge.visible = true; });
            applyVisibility(visible);
            maskMaterial.dispose();
          }
        } else if (highlightIds?.size) {
          const groups = groupInstructionHighlights(highlightOccurrences, new Set([...highlightIds].filter(id => visible.has(id))));
          drawInstructionOutlines(context, camera, instructionGroupFrames(groups, highlightOccurrences, assembly.matrixWorld),
            renderSize.width, renderSize.height);
        }
        const image = output.toDataURL("image/png");
        checkContext();
        return image;
      },
      dispose,
    };
    return releaseBetweenInstructionImages(images, imported, renderer, output);
  } catch (error) {
    dispose();
    throw error;
  }
}
