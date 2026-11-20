import { readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { renderReleasePrivacy } from "./release-privacy.mjs";

const template = await readFile(new URL("../../artifacts/brickbuilder-mobile/public/privacy.html", import.meta.url), "utf8");
const fixture = {
  PRIVACY_CONTROLLER_NAME: 'Example & <script>"Name"</script>',
  PRIVACY_CONTROLLER_STREET: "Example street 1",
  PRIVACY_CONTROLLER_POSTAL_CITY: "12345 Example City",
  PRIVACY_CONTROLLER_COUNTRY: "Example Country",
};
test("renders all four fields as escaped text without altering source or unrelated content", () => {
  const result = renderReleasePrivacy(template, fixture);
  assert.ok(result.includes("Example &amp; &lt;script&gt;&quot;Name&quot;&lt;/script&gt;"));
  assert.ok(result.includes("Example street 1"));
  assert.ok(result.includes("12345 Example City"));
  assert.ok(result.includes("Example Country"));
  assert.ok(result.includes("support@blackfishbox.de"));
  assert.ok(template.includes("[Name des Verantwortlichen]"));
  assert.ok(!result.includes("[Name des Verantwortlichen]"));
  assert.ok(!result.includes('Example & <script>"Name"</script>'));
});
test("fails closed for every missing release field", () => {
  for (const key of Object.keys(fixture)) {
    assert.throws(() => renderReleasePrivacy(template, { ...fixture, [key]: "" }),
      error => error.message === `Missing or invalid release secret: ${key}`);
  }
});
test("rejects placeholders, control characters and oversized values without logging them", () => {
  for (const value of ["[Name]", "PRIVATE\nVALUE", "x".repeat(301)]) {
    assert.throws(() => renderReleasePrivacy(template, { ...fixture, PRIVACY_CONTROLLER_NAME: value }),
      error => error.message === "Missing or invalid release secret: PRIVACY_CONTROLLER_NAME");
  }
});
test("rejects missing or duplicate source placeholders", () => {
  assert.throws(() => renderReleasePrivacy(template.replace("[Land]", ""), fixture), /exactly one/);
  assert.throws(() => renderReleasePrivacy(template + "[Land]", fixture), /exactly one/);
});
