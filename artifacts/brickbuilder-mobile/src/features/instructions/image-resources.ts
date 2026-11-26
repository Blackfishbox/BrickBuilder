import { Group, InstancedMesh, LineSegments, Mesh, type BufferGeometry, type WebGLRenderer } from "three";
import { measureImportedScene } from "../engine/imported-scene";
import type { InstructionImageRenderer } from "./render";

export const RELEASE_IMAGE_BUFFERS_ABOVE = 24 * 1024 * 1024;

/**
 * Retain immutable CPU geometry, not its GPU upload, between large PDF images.
 * Three.js uploads disposed geometry again on demand. Keep the same context:
 * recreating contexts per page can itself exhaust Android's context quota.
 */
export function releaseBetweenInstructionImages(
  images: InstructionImageRenderer, imported: Group | undefined,
  renderer: WebGLRenderer, output: HTMLCanvasElement,
): InstructionImageRenderer {
  if (!imported || measureImportedScene(imported).bufferBytes < RELEASE_IMAGE_BUFFERS_ABOVE) return images;
  let disposed = false;
  return {
    image(...args) {
      try {
        return images.image(...args);
      } finally {
        const geometries = new Set<BufferGeometry>();
        imported.traverse(object => {
          if (object instanceof InstancedMesh) object.dispose();
          if (object instanceof Mesh || object instanceof LineSegments) geometries.add(object.geometry);
        });
        geometries.forEach(geometry => geometry.dispose());
        renderer.renderLists.dispose();
        // Pixel data has already been copied into the returned PNG.
        renderer.setSize(1, 1);
        output.width = 1; output.height = 1;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      images.dispose();
    },
  };
}
