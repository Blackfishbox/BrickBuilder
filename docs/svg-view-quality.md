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

## Enforced budgets

- 5,000,000 input triangles.
- 600,000 retained vector triangles **including all generated fragments** and
  original triangles, even when an original was subsequently replaced.
- 24,000,000 visibility work units and 128 partition levels.
- 16 MiB encoded output, without an intermediate giant joined string.
- At most 2,048 path reuse entries and approximately 24 KiB per compound batch.
- Export-owned numeric face payload <78 MiB, visibility/sort lists and scratch
  budgeted <24 MiB, encoded chunks plus finished output <=32 MiB, bounded
  reuse/scratch <2 MiB (approximately 136 MiB total payload envelope, excluding
  the already loaded model, JS engine overhead and platform sharing).

All additional fragments count against the same face store, not an unaccounted
second geometry cache. Traversal, projection, sorting, visibility partitioning,
emission and byte copying cooperate with the cancellation/task-yield mechanism.
Every budget exhaustion throws the localized complexity error; an incomplete
or degraded file is never returned as a successful SVG. An over-budget detailed
model may need hidden parts or PNG even when its input count is below 600,000.

## Honest limitations

The uploaded vehicle screenshot was inspected as visual evidence only. Its model
and original SVG were not provided, so this is not a reproduction of that exact
vehicle or a claim about the cause of every mark in that screenshot. No physical
Android testing or external vector-editor qualification was performed.

SVG's vector diffuse/Gouraud approximation is not identical to WebGL's fragment
lighting, transparency sorting or antialiasing. Perspective variation of lighting
within a triangle is approximated in screen space; gradients do not add geometric
facets. There are no WebGL texture, shadow, metallic/specular or transmission
effects in this vector exporter. Source vertex colors retain the previous
per-face average. Distinct physical transparent layers are intentionally retained.
Compound batches are bounded, so very large connected surfaces can still have
small antialiasing seams between batches. Pathological intersections fail at the
explicit budgets, not with missing triangles or an image fallback.
