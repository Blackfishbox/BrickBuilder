import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { test } from "node:test";
import { discardPlayEdit, loadEnglishListing, prepareEnglishListingEdit, validateListing } from "./play-store-listing.mjs";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const serviceAccountJson = JSON.stringify({
  type: "service_account",
  client_email: "play-release@example.test",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  token_uri: "https://oauth2.googleapis.com/token",
});
const listing = {
  title: "BrickBuilder Mobile",
  shortDescription: "Design and build brick models in a touch-first 3D workshop.",
  fullDescription: "Build models locally.\n\nWORK OFFLINE\n• Projects stay on your device.",
};
const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "Content-Type": "application/json" },
});

function makePlayApi({ existingListing, failListingUpdate = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const target = String(url);
    calls.push({ url: target, method: options.method, body: options.body });
    if (target === "https://oauth2.googleapis.com/token") {
      const params = new URLSearchParams(options.body);
      assert.equal(params.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
      const assertion = params.get("assertion");
      const [header, payload, signature] = assertion.split(".");
      assert.equal(JSON.parse(Buffer.from(header, "base64url").toString()).alg, "RS256");
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
      assert.equal(claims.iss, "play-release@example.test");
      assert.equal(claims.scope, "https://www.googleapis.com/auth/androidpublisher");
      assert.equal(claims.aud, "https://oauth2.googleapis.com/token");
      assert.equal(Number.isInteger(claims.iat), true);
      assert.equal(claims.exp, claims.iat + 3600);
      assert.equal(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, "base64url")), true);
      return jsonResponse({ access_token: "test-token" });
    }
    if (target.endsWith("/applications/brickbuilder.blackfishbox.de/edits") && options.method === "POST") {
      return jsonResponse({ id: "edit-123" });
    }
    if (target.endsWith("/edits/edit-123/listings/en-US") && options.method === "GET") {
      return existingListing ? jsonResponse(existingListing) : new Response("", { status: 404 });
    }
    if (target.endsWith("/edits/edit-123/listings/en-US") && options.method === "PUT") {
      if (failListingUpdate) return jsonResponse({ error: { message: "forbidden" } }, 403);
      return jsonResponse(JSON.parse(options.body));
    }
    if (target.endsWith("/edits/edit-123:commit") && options.method === "POST") return jsonResponse({ id: "edit-123" });
    if (target.endsWith("/edits/edit-123") && options.method === "DELETE") return new Response(null, { status: 204 });
    throw new Error(`Unexpected Google Play request: ${options.method} ${target}`);
  };
  return { calls, fetchImpl };
}

test("English listing source stays within Google Play text limits", () => {
  const source = loadEnglishListing();
  assert.equal(source.title, "BrickBuilder Mobile");
  assert.ok([...source.title].length <= 30);
  assert.ok([...source.shortDescription].length <= 80);
  assert.ok([...source.fullDescription].length <= 4000);
  assert.throws(() => validateListing({ ...listing, shortDescription: "x".repeat(81) }), /shortDescription.*80/);
  assert.throws(() => validateListing({ ...listing, fullDescription: "x".repeat(4001) }), /fullDescription.*4000/);
});

test("prepares an en-US listing in the shared release edit and preserves an existing video", async () => {
  const { calls, fetchImpl } = makePlayApi({ existingListing: { language: "en-US", video: "https://video.example.test/demo" } });
  const result = await prepareEnglishListingEdit({
    serviceAccountJson, listing, fetchImpl, now: 1_800_000_000,
  });
  assert.deepEqual(result, { editId: "edit-123", changed: true });
  const put = calls.find(call => call.method === "PUT");
  assert.ok(put.url.endsWith("/edits/edit-123/listings/en-US"));
  assert.deepEqual(JSON.parse(put.body), {
    language: "en-US",
    ...listing,
    video: "https://video.example.test/demo",
  });
  assert.equal(calls.some(call => call.url.endsWith(":commit")), false);
});

test("leaves an unchanged localized listing in the shared release edit", async () => {
  const { calls, fetchImpl } = makePlayApi({ existingListing: { language: "en-US", ...listing } });
  const result = await prepareEnglishListingEdit({ serviceAccountJson, listing, fetchImpl, now: 1_800_000_000 });
  assert.deepEqual(result, { editId: "edit-123", changed: false });
  assert.equal(calls.some(call => call.method === "DELETE"), false);
  assert.equal(calls.some(call => call.url.endsWith(":commit")), false);
});

test("reports a listing permission error and abandons its uncommitted edit", async () => {
  const { calls, fetchImpl } = makePlayApi({ failListingUpdate: true });
  await assert.rejects(
    prepareEnglishListingEdit({ serviceAccountJson, listing, fetchImpl, now: 1_800_000_000 }),
    /HTTP 403.*manage this app's store listing/,
  );
  assert.equal(calls.some(call => call.method === "DELETE"), true);
  assert.equal(calls.some(call => call.url.endsWith(":commit")), false);
});

test("discards the shared Play edit after a later workflow step fails", async () => {
  const { calls, fetchImpl } = makePlayApi();
  await discardPlayEdit({ serviceAccountJson, editId: "edit-123", fetchImpl });
  assert.equal(calls.at(-1).method, "DELETE");
  assert.ok(calls.at(-1).url.endsWith("/edits/edit-123"));
});
