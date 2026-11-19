import {
  AmbientLight, Box3, BoxGeometry, Color, CylinderGeometry, DirectionalLight,
  Group, InstancedBufferAttribute, InstancedBufferGeometry, InstancedMesh, Matrix4,
  Mesh, MeshLambertMaterial, OrthographicCamera, Scene, Vector3, WebGLRenderer,
} from "three";
import { BRICK_DEFINITIONS, BRICK_HEIGHT, type BuilderDocument } from "../editor/model";
import { createImportedGroupAsync, disposeImportedScene } from "../engine/imported-scene";
import type { InstructionStep } from "./types";
import { createSoftwareInstructionRenderer } from "./software-render";
import { instructionDisplayColor } from "./highlight-color";
import { drawInstructionOutlines, groupInstructionHighlights, instructionHighlightOccurrences, instructionGroupBounds } from "./outlines";
import { applyPdfStepCamera } from "./camera";

const FOCUS_ATTRIBUTE = "instructionFocus";
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

export interface InstructionImageRenderer {
  image(visible: Set<string>, step: InstructionStep, highlightIds?: ReadonlySet<string>): string;
  dispose(): void;
}

/** One reusable, bounded WebGL context for the entire PDF, not one scene per page. */
export async function createInstructionRenderer(document: BuilderDocument, signal?: AbortSignal): Promise<InstructionImageRenderer> {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
  } catch {
    return createSoftwareInstructionRenderer(document, signal);
  }
  renderer.setPixelRatio(1);
  renderer.setSize(1000, 760);
  renderer.setClearColor("#ffffff");
  const scene = new Scene(), pivot = new Group(), assembly = new Group();
  scene.add(pivot); pivot.add(assembly);
  scene.add(new AmbientLight(0xffffff, 2.1));
  const light = new DirectionalLight(0xffffff, 2.7);
  light.position.set(10, 18, 12); scene.add(light);
  const camera = new OrthographicCamera(-10, 10, 7.6, -7.6, 0.01, 100000);
  let imported: Group | undefined;
  const brickColors = new Map<string, Color>();
  const brickMaterials = new Map<string, MeshLambertMaterial>();
  const output = globalThis.document.createElement("canvas");
  output.width = 1000; output.height = 760;
  try {
    if (document.imported) {
      imported = await createImportedGroupAsync(document.imported, { signal });
      assembly.add(imported);
    }
    for (const part of document.bricks) {
      const definition = BRICK_DEFINITIONS[part.type], group = new Group();
      group.userData.partId = part.id;
      const material = new MeshLambertMaterial({ color: new Color(part.color) });
      brickColors.set(part.id, material.color.clone());
      brickMaterials.set(part.id, material);
      const box = new Mesh(new BoxGeometry(definition.studsX * 0.96, BRICK_HEIGHT, definition.studsZ * 0.96), material);
      box.position.y = BRICK_HEIGHT / 2; group.add(box);
      for (let x = 0; x < definition.studsX; x++) for (let z = 0; z < definition.studsZ; z++) {
        const stud = new Mesh(new CylinderGeometry(0.3, 0.3, 0.18, 16), material);
        stud.position.set(x - (definition.studsX - 1) / 2, BRICK_HEIGHT + 0.09, z - (definition.studsZ - 1) / 2);
        group.add(stud);
      }
      group.position.set(part.x, part.y, part.z);
      group.rotation.set((part.tiltX ?? 0) * Math.PI / 180, part.rotation * Math.PI / 180, (part.tiltZ ?? 0) * Math.PI / 180, "XYZ");
      assembly.add(group);
    }
    const bounds = new Box3().setFromObject(assembly);
    const center = bounds.isEmpty() ? new Vector3() : bounds.getCenter(new Vector3());
    const radius = bounds.isEmpty() ? 2 : Math.max(1, bounds.getSize(new Vector3()).length() / 2);
    assembly.position.sub(center);
    const aspect = 1000 / 760;
    camera.left = -radius * 1.12 * aspect; camera.right = -camera.left;
    camera.top = radius * 1.12; camera.bottom = -camera.top;
    camera.far = Math.max(100, radius * 12);
    camera.position.set(1.1, 0.85, 1.3).normalize().multiplyScalar(radius * 4);
    camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
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
    return {
      image(visible, step, highlightIds) {
        signal?.throwIfAborted();
        const rotation = step.rotation ?? [0, 0, 0];
        pivot.rotation.set(...rotation.map(angle => angle * Math.PI / 180) as [number, number, number]);
        applyPdfStepCamera(camera, radius, step.camera);
        for (const [id, material] of brickMaterials) {
          material.color.copy(brickColors.get(id)!);
          if (highlightIds !== undefined) instructionDisplayColor(material.color, highlightIds.has(id));
        }
        applyPdfInstructionFocus(imported, highlightIds);
        assembly.traverse(object => {
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
        renderer.render(scene, camera);
        if (highlightIds?.size) {
          const context = output.getContext("2d");
          if (!context) throw new Error("PDF-Konturen konnten nicht gezeichnet werden.");
          context.drawImage(renderer.domElement, 0, 0);
          const boxes = new Map<string, Box3>();
          assembly.traverse(object => {
            if (object.userData.partId && visible.has(object.userData.partId) && highlightIds.has(object.userData.partId)) {
              boxes.set(object.userData.partId, new Box3().setFromObject(object));
            }
            if (!(object instanceof Mesh)) return;
            if (!(object instanceof InstancedMesh)) return;
            const ids = object.userData.brickIds as string[] | undefined;
            if (!ids) return;
            object.geometry.computeBoundingBox();
            ids.forEach((id, index) => {
              if (!visible.has(id) || !highlightIds.has(id)) return;
              object.getMatrixAt(index, matrix);
              const box = object.geometry.boundingBox!.clone().applyMatrix4(matrix).applyMatrix4(object.matrixWorld);
              if (boxes.has(id)) boxes.get(id)!.union(box); else boxes.set(id, box);
            });
          });
          const groups = groupInstructionHighlights(highlightOccurrences, new Set([...highlightIds].filter(id => visible.has(id))));
          drawInstructionOutlines(context, camera, instructionGroupBounds(groups, boxes), 1000, 760);
          return output.toDataURL("image/jpeg", 0.84);
        }
        return renderer.domElement.toDataURL("image/jpeg", 0.84);
      },
      dispose() {
        if (imported) disposeImportedScene(imported);
        for (const group of assembly.children.filter(child => child !== imported)) {
          group.traverse(object => {
            if (object instanceof Mesh) {
              object.geometry.dispose();
              for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
            }
          });
        }
        renderer.dispose(); renderer.forceContextLoss();
        output.width = 1; output.height = 1;
      },
    };
  } catch (error) {
    if (imported) disposeImportedScene(imported);
    renderer.dispose(); renderer.forceContextLoss();
    throw error;
  }
}
