# Vector view export: quality and limits

## What changed

The current SVG export no longer relies on a global triangle-centre painter
sort for visibility. NDC depth is affine across a projected triangle, allowing a
projected BSP to split crossing faces along their actual intersection. Far and
near fragments are painted in geometric order. Opaque surfaces cover fragments
behind them; translucent surfaces still composite separate layers. Stable
coplanar ordering preserves source traversal order when depth is genuinely tied.

Large opaque panels are preferred as separating planes to avoid cutting a roof
with every small wheel facet. Large spatially separated sets can first partition
in screen space. An all-coplanar fast path avoids fragmenting highly tessellated
flat surfaces. There is no unbounded pairwise overlap graph.

Smooth vertex normals use the inverse-transpose world/instance transform.
Hard/flat materials retain geometric normals; reflected instances keep WebGL's
front-face convention. Hemisphere and sun settings are shared with the builder.
Diffuse light is evaluated in linear space and interpolated using genuine SVG
linear gradients with `linearRGB` interpolation, then encoded as sRGB. Basic
materials remain unlit; Lambert emissive colors are retained. Flat, coplanar,
same-instance/same-style fragments can share a compound path, avoiding the
diagonal alpha/seam artifacts of separately painting their triangles.

No image is embedded. Background is transparent, camera projection/framing is
unchanged, source geometry/materials are neither cloned into expanded instances
nor disposed or reparented. PNG and PDF rendering are unchanged.

## Reproducible evidence

Start the existing BrickBuilder Mobile development workflow and open
`/visual-fixtures/svg-comparison.html` (relative to the artifact's base path).
The dev-only comparison is not a production entry point. It shows a public,
deterministic vehicle on white and dark backgrounds with one camera:

1. Frozen previous average-depth/geometric-normal method for this fixture.
2. The actual new SVG exporter.
3. WebGL with the actual builder lights, sRGB output, alpha and antialiasing,
   matching the PNG renderer settings.

Observed comparison: cleaner opaque roof, no unrelated dark window triangles,
smooth wheel faces instead of the previous triangular streaks; illumination and
glass resemble the WebGL reference. Fine antialiasing at some surface boundaries
still differs. A captured comparison is delivered separately as
`generated-artifacts/svg-vehicle-comparison.jpg`; generated files are ignored by
Git and deployment.

Automated `svg-appearance.test.ts` rasterizes the **actual exported SVG** using
resvg, rather than only counting paths. Tests cover:

- a frozen failing legacy-depth reproduction and correct hidden/visible halves;
- an independent per-pixel depth and source-over oracle for crossing opaque and
  translucent panels, excluding antialiased intersection/silhouette pixels;
- separately retained glass layers and glass hidden by opaque panels;
- a differently tessellated window with constant alpha across its diagonals;
- smooth vs. deliberately flat lighting, reflected front-facing geometry, and
  emissive colors;
- the public vehicle's opaque roof interior and transparent background on both
  backgrounds, with deterministic output;
- operation, partition-depth and fragment exhaustion with successful retry.

Existing tests retain camera/parent/instance transforms, material groups, vertex
colors, clipping, pre-start and per-stage cancellation, output/input handling and
two separate >150,000-triangle responsive exports (160,001 overlapping instances
and 160,001 distinct visible triangles). The latter can now share compound paths:
triangle completeness is checked by path commands rather than DOM element count.

Run all frontend tests and TypeScript checks:

```sh
pnpm --filter @workspace/brickbuilder-mobile test
pnpm --filter @workspace/brickbuilder-mobile run typecheck
```

## External SVG compatibility check

The small, public fixture
[`svg-compatibility.svg`](../artifacts/brickbuilder-mobile/test-fixtures/svg-compatibility.svg)
is actual `renderSvgView` output, not hand-authored substitute markup. The
ordinary `svg-view-export.test.ts` suite regenerates it from
`test-fixtures/svg-compatibility.ts`, checks byte-for-byte determinism (ignoring
the text file's final newline), resolves every `<use href>` against a unique
path definition, and rasterizes it with resvg against independent pixel
expectations. Reused definitions carry no fill: the individual uses supply red,
green or translucent blue.

### Repeat the external check

From the repository root, with `inkscape`, `chromium`, `rsvg-convert`,
ImageMagick's `identify` and `convert`, and the normal pnpm dependencies on PATH:

```sh
pnpm --filter @workspace/brickbuilder-mobile run check:svg-compatibility
```

Inkscape and librsvg are included in the workspace's Nix packages. Chromium and
ImageMagick are supplied by this development environment; elsewhere install
them separately. No external tool is required by the normal unit tests.
The external check fails explicitly on a missing program, timeout, nonzero
exit, unexpected image size or incorrect pixel. It does not skip a missing
renderer. It opens the same generated file independently in:

- Inkscape's own headless SVG importer/PNG exporter, using the page bounds and
  zero background opacity;
- Chromium's headless standalone SVG viewer, at 320 × 240 and device scale 1,
  with a transparent browser background;
- `rsvg-convert`, the GNOME/librsvg rendering engine, as an additional check.

ImageMagick **only decodes the resulting PNGs**; it never renders the SVG.
The executable commands and flags are in
`artifacts/brickbuilder-mobile/scripts/check-svg-compatibility.ts`. Output is
written to ignored `generated-artifacts/svg-compatibility/`: `reference.svg`,
three PNGs, and `report.json` with actual tool versions, SHA-256, and every
expected/observed RGBA sample. All outputs are local; nothing is uploaded.

For a manual repeat, open `reference.svg` directly in Inkscape and Chromium.
Use Inkscape's page checkerboard, or place a temporary background below the
artwork (do not save that background into the fixture). At the top, the left
triangle is purple (blue at 50% over opaque red); the right one is translucent
blue-green (blue at 50% over green at 50%). The yellow lower-left polygon is
clipped at the left and bottom page edges. The cyan lower-right polygon has a
flat lower edge where the near camera plane cut away its tip. Empty areas must
remain transparent; inspect against both light and dark backgrounds.

### Recorded result

The check passed with Inkscape **1.4.2** (ebf0e940d0, 2025-05-08), Chromium
**155.0.8059.79**, and librsvg **2.60.0**. The 777-byte generated SVG has SHA-256
`01b03de548c3fd0761290786f9440b5b6d6cb6b66f821f56b9be672c9d51848f`
(without the committed text fixture's trailing newline).

| Pixel (x, y) | Checks | Expected straight RGBA | Observed in all three |
| --- | --- | --- | --- |
| 160, 120 | Transparent background | alpha 0 | alpha 0 |
| 40, 40 | Reused red/blue path, correct depth order | 128, 0, 128, 255 | 127, 0, 128, 255 |
| 200, 40 | Reused green/blue path, two transparent layers | 0, 85, 170, 191 | 0, 85, 170, 192 |
| 2, 165 | Viewport-clipped yellow polygon | 255, 255, 0, 255 | exact |
| 240, 165 | Retained near-plane-clipped cyan polygon | 0, 255, 255, 255 | exact |
| 240, 210 | Removed cyan tip | alpha 0 | alpha 0 |

Two levels of 8-bit rounding tolerance are allowed. RGB under alpha zero is
undefined and intentionally not compared (Inkscape writes white there).
resvg exposes premultiplied pixels, so the ordinary unit test unpremultiplies
before comparing these straight-RGBA expectations. The scene submits near blue
before far red/green, so simply preserving traversal order fails the check.

These versions accept SVG 2 `href` directly; no duplicate `xlink:href` or
exporter change was needed. This is a small-fixture import/render check using
the actual programs in headless mode, **not** an interactive editor
round-trip, a large-model performance test, a gradient qualification, or a
promise about every SVG editor/version.

## Enforced budgets and segmented output

The exporter first tries one viewport. If a per-segment budget is reached, it
clips the view into smaller, non-overlapping SVG viewports and retries each
viewport independently. Every segment still runs the full visibility ordering
for all faces that cross it; this is not a simple concatenation of independently
sorted model layers. The result is one valid SVG document containing the
clipped viewports. Existing projected mesh and instance bounds skip geometry
that cannot appear in a viewport, reducing repeated traversal for spatially
separated builds without introducing a blocking bounds scan.

- Source triangles are scanned in batches of 10,000,000 without retaining an
  input-triangle list. Repeated tile passes count toward a 250,000,000 cumulative
  projection-work ceiling.
- 900,000 retained vector triangles **per segment**, including all generated
  visibility fragments and original triangles, even when an original was
  subsequently replaced.
- 384,000,000 visibility work units and 256 partition levels per segment.
- 32 MiB encoded output per segment; the merged SVG is streamed and capped at
  512 MiB total and 256 segments.
- At most 4,096 path reuse entries and approximately 24 KiB per compound batch.
- Export-owned numeric face payload <117 MiB, visibility/sort lists and scratch
  budgeted <36 MiB, one segment's encoded chunks plus finished output <=64 MiB,
  bounded reuse/scratch <4 MiB (approximately 221 MiB peak export payload,
  excluding the already loaded model, JS engine overhead and platform sharing).
  Segments are written sequentially so the exporter does not retain every
  segment in memory.

These raised ceilings permit more complex exports but do not guarantee that a
device can complete them. The SVG renderer can now temporarily require over
200 MiB in its own export buffers, in addition to the loaded model, WebView and
native sharing overhead. Lower-memory Android devices may still fail or be
terminated by the operating system before reaching a configured guard. The
native Android large-file and background/foreground acceptance test remains
separate and has not been performed.

All additional fragments count against the active segment's face store, not an
unaccounted second geometry cache. Traversal, projection, sorting, visibility
partitioning, emission and byte copying cooperate with cancellation and task
yielding. If the exporter still reaches the total work/file/segment ceiling, it
shows the localized complexity error and does not share or download an
incomplete SVG. A highly overlapping cluster may not become simpler when the
viewport is split; hiding parts or using PNG can still be necessary.

## Honest limitations

The uploaded vehicle screenshot was inspected as visual evidence only. Its model
and original SVG were not provided, so this is not a reproduction of that exact
vehicle or a claim about the cause of every mark in that screenshot. No physical
Android testing was performed. External SVG compatibility is limited to the
small fixture and exact program versions described above.

SVG's vector diffuse/Gouraud approximation is not identical to WebGL's fragment
lighting, transparency sorting or antialiasing. Perspective variation of lighting
within a triangle is approximated in screen space; gradients do not add geometric
facets. There are no WebGL texture, shadow, metallic/specular or transmission
effects in this vector exporter. Source vertex colors retain the previous
per-face average. Distinct physical transparent layers are intentionally retained.
Compound batches are bounded, so very large connected surfaces can still have
small antialiasing seams between batches. Pathological intersections fail at the
explicit budgets, not with missing triangles or an image fallback.
