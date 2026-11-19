import assert from "node:assert/strict";
import { test } from "node:test";
import {
  previousPublishedCommit, releaseNotesSince, summarizeCommitMessages, validateNotes,
} from "./play-release-notes.mjs";

test("uses concrete German commit trailers in history order", () => {
  assert.equal(summarizeCommitMessages([
    "Soften faded instruction colors\n\nRelease-Notes-DE: Bereits verbaute Anleitungsteile erscheinen jetzt mit fast unveränderten Farben.",
    "Expand 3D building area\n\nRelease-Notes-DE: Der Boden wächst jetzt mit dem Modell, wenn es über den bisherigen Rand hinausragt.",
  ]), "• Bereits verbaute Anleitungsteile erscheinen jetzt mit fast unveränderten Farben.\n• Der Boden wächst jetzt mit dem Modell, wenn es über den bisherigen Rand hinausragt.");
});

test("deduplicates identical notes from multiple commits without inventing summaries", () => {
  assert.equal(summarizeCommitMessages([
    "First commit\n\nRelease-Notes-DE: Teilefarben bleiben besser erkennbar.",
    "Retry after failed workflow\n\nRelease-Notes-DE: Teilefarben bleiben besser erkennbar.",
  ]), "• Teilefarben bleiben besser erkennbar.");
});

test("requires a precise note in every included commit", () => {
  assert.throws(() => summarizeCommitMessages(["Adjust workflow", "Fix camera\n\nRelease-Notes-DE: Die Ansicht bleibt beim Drehen erhalten."]), /Adjust workflow.*must contain exactly one/s);
  assert.throws(() => summarizeCommitMessages(["Missing trailer"]), /Release-Notes-DE/);
  assert.throws(() => summarizeCommitMessages([]), /No commits/);
});

test("enforces the 500-character limit instead of truncating release notes", () => {
  assert.equal([...summarizeCommitMessages([`Change\n\nRelease-Notes-DE: ${"x".repeat(498)}`])].length, 500);
  assert.throws(() => summarizeCommitMessages([`Change\n\nRelease-Notes-DE: ${"x".repeat(499)}`]), /allows 500/);
  assert.throws(() => summarizeCommitMessages([
    `Change one\n\nRelease-Notes-DE: ${"a".repeat(250)}`,
    `Change two\n\nRelease-Notes-DE: ${"b".repeat(250)}`,
  ]), /Shorten or deduplicate/);
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

test("reads first-parent messages since the last release, including merge notes and failed attempts", () => {
  const calls = [];
  assert.equal(releaseNotesSince("a".repeat(40), (...args) => {
    calls.push(args);
    return "Merge current main\n\nRelease-Notes-DE: Importierte Anleitungen zeigen Drehungen und Callouts.\0" +
      "Fix retry\n\nRelease-Notes-DE: Importierte Anleitungen zeigen Drehungen und Callouts.\0";
  }), "• Importierte Anleitungen zeigen Drehungen und Callouts.");
  assert.deepEqual(calls[0], ["log", "--first-parent", "--reverse", "--format=%B%x00", `${"a".repeat(40)}..HEAD`, "--"]);
});

test("uses only the latest commit as baseline for an initial manual release", () => {
  const calls = [];
  const notes = releaseNotesSince(null, (...args) => {
    calls.push(args);
    return "Publish Android improvements\n\nRelease-Notes-DE: Android-Installation und Teilevorschau wurden verbessert.\0";
  });
  assert.equal(notes, "• Android-Installation und Teilevorschau wurden verbessert.");
  assert.deepEqual(calls[0], ["log", "--first-parent", "-1", "--format=%B%x00", "HEAD", "--"]);
});
