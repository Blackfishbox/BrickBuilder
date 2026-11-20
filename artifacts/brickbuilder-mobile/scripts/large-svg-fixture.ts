import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { largeSvgModel } from "../test-fixtures/large-svg-model";
import { renderSvgView } from "../src/features/engine/svg-view-export";

// Outputs stay outside Git and release assets.
const output = new URL("../../../generated-artifacts/android-svg-share/", import.meta.url);
const fixture = largeSvgModel();
try {
  const bytes = await renderSvgView([fixture.model], fixture.camera, 2160, 3840);
  const report = {
    sourceTriangles: fixture.triangles,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    androidDeviceTest: "NOT RUN",
  };
  await mkdir(output, { recursive: true });
  await writeFile(new URL("reference.svg", output), bytes);
  await writeFile(new URL("reference.json", output), JSON.stringify(report, null, 2) + "\n");
  console.log(fileURLToPath(output), report);
} finally {
  fixture.dispose();
}
