import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { renderSvgView } from "../src/features/engine/svg-view-export";
import { svgCompatibilityFixture, svgCompatibilitySamples } from "../test-fixtures/svg-compatibility";
import { collectByteSource } from "../src/types/byte-source";

// Fail explicitly when a program is missing; this is an opt-in external check,
// not a silently skipped part of the ordinary unit suite.
function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command}: ${result.stderr.toString()}`);
  return result.stdout;
}

const output = new URL("../../../generated-artifacts/svg-compatibility/", import.meta.url);
await mkdir(output, { recursive: true });
const path = (name: string) => fileURLToPath(new URL(name, output));
const fixture = svgCompatibilityFixture();
try {
  const bytes = await collectByteSource(renderSvgView(fixture.roots, fixture.camera, fixture.width, fixture.height));
  await writeFile(path("reference.svg"), bytes);
  const renderers = [
    { name: "Inkscape", command: "inkscape", args: [
      path("reference.svg"), "--export-type=png", "--export-area-page",
      "--export-background-opacity=0", `--export-filename=${path("inkscape.png")}`,
    ], image: "inkscape.png" },
    { name: "Chromium SVG viewer", command: "chromium", args: [
      "--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
      "--force-device-scale-factor=1", "--default-background-color=00000000",
      "--window-size=320,240", `--screenshot=${path("chromium.png")}`,
      new URL("reference.svg", output).href,
    ], image: "chromium.png" },
    { name: "GNOME librsvg", command: "rsvg-convert", args: [
      "--output", path("librsvg.png"), path("reference.svg"),
    ], image: "librsvg.png" },
  ];
  const results = [];
  for (const renderer of renderers) {
    const version = run(renderer.command, ["--version"]).toString().trim();
    run(renderer.command, renderer.args);
    assert.ok((await readFile(path(renderer.image))).length > 0);
    const size = run("identify", ["-format", "%wx%h", path(renderer.image)]).toString();
    assert.equal(size, `${fixture.width}x${fixture.height}`, renderer.name);
    // ImageMagick only decodes PNG here; it must not render SVG on our behalf.
    const pixels = run("convert", [path(renderer.image), "-depth", "8", "rgba:-"]);
    assert.equal(pixels.length, fixture.width * fixture.height * 4);
    const samples = svgCompatibilitySamples.map(sample => {
      const offset = (sample.y * fixture.width + sample.x) * 4;
      const actual = [...pixels.subarray(offset, offset + 4)];
      // Fully transparent pixels have no defined RGB; all other channels allow
      // two levels for different 8-bit source-over rounding implementations.
      const passed = sample.rgba.every((expected, channel) =>
        (sample.rgba[3] === 0 && channel < 3) || Math.abs(actual[channel] - expected) <= 2);
      return { ...sample, actual, passed };
    });
    results.push({ name: renderer.name, version, image: renderer.image, samples });
  }
  const report = {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length, width: fixture.width, height: fixture.height, results,
  };
  await writeFile(path("report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  assert.ok(results.every(result => result.samples.every(sample => sample.passed)),
    `SVG compatibility failed. See ${path("report.json")}`);
} finally {
  fixture.dispose();
}
