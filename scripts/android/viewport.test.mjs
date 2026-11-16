import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
import { renderAndroidViewport } from "./viewport.mjs";

test("only the generated Android viewport changes; the PWA source keeps cover", async () => {
  const source = await readFile(new URL("../../artifacts/brickbuilder-mobile/index.html", import.meta.url), "utf8");
  const result = renderAndroidViewport(source);
  assert.match(result, /name="viewport"[^>]*viewport-fit=contain/);
  assert.doesNotMatch(result, /viewport-fit=cover/);
  assert.equal(result.replace("viewport-fit=contain", "viewport-fit=cover"), source);
  assert.match(source, /viewport-fit=cover/);
});

test("unexpected or duplicate viewport configuration fails explicitly", () => {
  for (const html of ["", "viewport-fit=contain", "viewport-fit=cover viewport-fit=cover"]) {
    assert.throws(() => renderAndroidViewport(html), /Expected exactly one/);
  }
});
