import assert from "node:assert/strict";
import { test } from "node:test";
import { changedPaths, previousPublishedCommit, summarizeChangedPaths, validateNotes } from "./play-release-notes.mjs";

test("summarizes real changed areas in German without repeating overlapping matches", () => {
  assert.equal(summarizeChangedPaths([
    "artifacts/brickbuilder-mobile/src/features/inventory/import.ts",
    "artifacts/brickbuilder-mobile/src/features/inventory/list.tsx",
    "artifacts/brickbuilder-mobile/src/platform/geometry-request.ts",
  ]), "• Import, Export und BrickLink-Teilelisten überarbeitet.\n• Teilesuche, Farben und Geometrien überarbeitet.");
});

test("all areas fit Google's limit and unknown or empty changes remain truthful", () => {
  const notes = summarizeChangedPaths([
    "features/import/a.ts", "features/colors/a.ts", "features/engine/a.ts",
    "features/storage/a.ts", "features/privacy/a.ts", "app/android/a.java",
    ".github/workflows/android-google-play.yml", "other/component.tsx", "pnpm-lock.yaml",
  ]);
  assert.ok([...notes].length <= 500);
  assert.match(summarizeChangedPaths([]), /Erneute Bereitstellung/);
  assert.match(summarizeChangedPaths(["README.md"]), /Wartungsarbeiten/);
});

test("custom notes are bounded, trimmed and reject controls", () => {
  assert.equal(validateNotes("  Bessere Teileauswahl. \n"), "Bessere Teileauswahl.");
  assert.throws(() => validateNotes(" "), /1–500/);
  assert.throws(() => validateNotes("a".repeat(501)), /1–500/);
  assert.throws(() => validateNotes("a\u0000b"), /control/);
});

const env = {
  GH_TOKEN: "test-only", GITHUB_REPOSITORY: "example/app",
  GITHUB_RUN_NUMBER: "20", GITHUB_RUN_ID: "200",
};
const release = {
  id: 190, run_number: 19, name: "Build and publish closed Google Play test", head_sha: "a".repeat(40),
};
const response = (runs) => ({ ok: true, json: async () => ({ workflow_runs: runs }) });

test("ignores build-only runs and uses the last successful automated release", async () => {
  const sha = await previousPublishedCommit(env, async (url, options) => {
    assert.equal(url.searchParams.get("branch"), "android/google-play");
    assert.equal(url.searchParams.get("status"), "success");
    assert.equal(options.headers.Authorization, "Bearer test-only");
    return response([{ ...release, id: 195, name: "Build signed Google Play AAB" }, release]);
  });
  assert.equal(sha, release.head_sha);
});

test("first automated release has no invented history baseline", async () => {
  assert.equal(await previousPublishedCommit(env, async () => response([])), null);
});

test("API failures and stale runs cannot silently publish", async () => {
  await assert.rejects(previousPublishedCommit(env, async () => ({ ok: false, status: 403 })), /403/);
  await assert.rejects(previousPublishedCommit(env, async () => response([{ ...release, run_number: 21 }])), /newer/);
  await assert.rejects(previousPublishedCommit({}, async () => response([])), /context/);
});

test("reads all changed files since baseline, including intervening failed releases", () => {
  const calls = [];
  assert.deepEqual(changedPaths("a".repeat(40), (...args) => {
    calls.push(args);
    return "one.ts\0two.ts\0";
  }), ["one.ts", "two.ts"]);
  assert.deepEqual(calls[0], ["diff", "--name-only", "-z", "a".repeat(40), "HEAD", "--"]);
});
