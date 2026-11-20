import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { allowedLDrawOrigin } from "./ldraw-origin.ts";

describe("LDraw browser origin allowlist", () => {
  it("allows the exact Replit preview origin", () => {
    assert.equal(
      allowedLDrawOrigin("https://preview.example.replit.dev", {
        REPLIT_DEV_DOMAIN: "preview.example.replit.dev",
      }),
      "https://preview.example.replit.dev",
    );
  });

  it("allows exact explicitly configured origins", () => {
    assert.equal(
      allowedLDrawOrigin("https://brickbuilder.example", {
        LDRAW_ALLOWED_ORIGINS: "https://other.example, https://brickbuilder.example",
      }),
      "https://brickbuilder.example",
    );
  });

  it("allows the exact HTTPS Capacitor Android WebView origin", () => {
    assert.equal(allowedLDrawOrigin("https://localhost"), "https://localhost");
  });

  it("rejects unlisted origins and origin lookalikes", () => {
    const environment = { REPLIT_DEV_DOMAIN: "preview.example.replit.dev" };
    for (const origin of [
      "https://evil.example",
      "https://preview.example.replit.dev.evil.example",
      "http://preview.example.replit.dev",
      "null",
      "https://preview.example.replit.dev/path",
    ]) {
      assert.equal(allowedLDrawOrigin(origin, environment), undefined, origin);
    }
  });

  it("ignores malformed configured values", () => {
    assert.equal(allowedLDrawOrigin("https://unlisted.example", {
      LDRAW_ALLOWED_ORIGINS: "*, https://trusted.example/path, not a url",
    }), undefined);
  });
});
