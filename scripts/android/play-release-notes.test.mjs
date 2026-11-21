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

test("aggregates German and English release notes independently", () => {
  const messages = [
    "Warn before offline imports\n\nRelease-Notes-DE: Android warnt beim Import, wenn Online-Nachladen deaktiviert ist.\nRelease-Notes-EN: Android warns during import when online geometry loading is disabled.",
    "Add an English Play listing\n\nRelease-Notes-DE: Eine englische Play-Store-Beschreibung und zweisprachige Versionshinweise werden ergänzt.\nRelease-Notes-EN: Added an English Play Store listing and bilingual release notes.",
  ];
  assert.equal(summarizeCommitMessages(messages, "de"),
    "• Android warnt beim Import, wenn Online-Nachladen deaktiviert ist.\n• Eine englische Play-Store-Beschreibung und zweisprachige Versionshinweise werden ergänzt.");
  assert.equal(summarizeCommitMessages(messages, "en"),
    "• Android warns during import when online geometry loading is disabled.\n• Added an English Play Store listing and bilingual release notes.");
});

test("deduplicates identical notes from multiple commits without inventing summaries", () => {
  assert.equal(summarizeCommitMessages([
    "First commit\n\nRelease-Notes-DE: Teilefarben bleiben besser erkennbar.",
    "Retry after failed workflow\n\nRelease-Notes-DE: Teilefarben bleiben besser erkennbar.",
  ]), "• Teilefarben bleiben besser erkennbar.");
});

test("a complete release note summarizes a batch with missing or oversized historical trailers", () => {
  const summary = "Mehrfachauswahl lässt sich gemeinsam bewegen und drehen. Kurzes Tippen wählt Teile aus; langes Drücken dreht die Kamera.";
  assert.equal(summarizeCommitMessages([
    "Older change without a release trailer",
    "Recent change\n\nRelease-Notes-DE: This historical note is superseded by the complete batch summary.",
    `Prepare release\n\nRelease-Notes-DE-Complete: ${summary}`,
  ]), summary);
  assert.throws(() => summarizeCommitMessages([
    "First summary\n\nRelease-Notes-DE-Complete: Zusammenfassung eins.",
    "Second summary\n\nRelease-Notes-DE-Complete: Zusammenfassung zwei.",
  ]), /exactly one/);
  assert.equal(summarizeCommitMessages([
    "Older commit without English notes",
    "Localization rollout\n\nRelease-Notes-EN-Complete: Added an English store listing and bilingual change notes.",
  ], "en"), "Added an English store listing and bilingual change notes.");
});

test("requires a precise note in every included commit", () => {
  assert.throws(() => summarizeCommitMessages(["Adjust workflow", "Fix camera\n\nRelease-Notes-DE: Die Ansicht bleibt beim Drehen erhalten."]), /Adjust workflow.*must contain exactly one/s);
  assert.throws(() => summarizeCommitMessages(["Missing trailer"]), /Release-Notes-DE/);
  assert.throws(() => summarizeCommitMessages([]), /No commits/);
});

test("skips only generated task-merge metadata without a release note", () => {
  assert.equal(summarizeCommitMessages([
    "Merge task results\n\nReplit-Task-Id: task-123\nReplit-Merge-Attempt: MergeTask:task-123",
    "Improve inventory import\n\nRelease-Notes-DE: Teilelisten zeigen nach dem Prüfen die Übernehmen-Schaltfläche direkt oben.",
  ]), "• Teilelisten zeigen nach dem Prüfen die Übernehmen-Schaltfläche direkt oben.");
  assert.throws(() => summarizeCommitMessages([
    "Merge task results\n\nReplit-Task-Id: task-123\nReplit-Merge-Attempt: MergeTask:task-123",
  ]), /No concrete German release notes/);
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
  assert.equal(validateNotes("  Better part selection. \n", "en"), "Better part selection.");
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
  const commits = [
    ["b".repeat(40), "Merge current main\n\nRelease-Notes-DE: Importierte Anleitungen zeigen Drehungen und Callouts."],
    ["c".repeat(40), "Fix retry\n\nRelease-Notes-DE: Importierte Anleitungen zeigen Drehungen und Callouts."],
  ];
  assert.equal(releaseNotesSince("a".repeat(40), (...args) => {
    calls.push(args);
    if (args[0] === "log") return commits.map(([sha, message]) => `${sha}\0${message}\0`).join("");
    return "";
  }), "• Importierte Anleitungen zeigen Drehungen und Callouts.");
  assert.deepEqual(calls[0], ["log", "--first-parent", "--reverse", "--format=%H%x00%B%x00", `${"a".repeat(40)}..HEAD`, "--"]);
});

test("requires both locales for commits unless a complete localized batch note is supplied", () => {
  assert.throws(() => summarizeCommitMessages([
    "A user-visible change\n\nRelease-Notes-DE: Importhinweis ergänzt.",
  ], "en"), /Release-Notes-EN/);
  assert.equal(releaseNotesSince("a".repeat(40), (...args) => {
    if (args[0] === "log") {
      return `${"b".repeat(40)}\0Localized change\n\nRelease-Notes-DE: Warnung ergänzt.\nRelease-Notes-EN: Added a warning.\0`;
    }
    return "";
  }, "en"), "• Added a warning.");
});

test("skips only unannotated release-pipeline changes, not app changes", () => {
  const messages = [
    ["b".repeat(40), "Adjust Play workflow retries"],
    ["c".repeat(40), "Improve mobile selection\n\nRelease-Notes-DE: Die Teileauswahl ist auf kleinen Displays besser erreichbar."],
  ];
  const git = (...args) => {
    if (args[0] === "log") return messages.map(([sha, message]) => `${sha}\0${message}\0`).join("");
    if (args[0] === "diff-tree" && args[5] === "b".repeat(40)) {
      return ".github/workflows/android-google-play.yml\n";
    }
    return "artifacts/brickbuilder-mobile/src/App.tsx\n";
  };
  assert.equal(releaseNotesSince("a".repeat(40), git),
    "• Die Teileauswahl ist auf kleinen Displays besser erreichbar.");

  const appCommit = "d".repeat(40);
  assert.throws(() => releaseNotesSince("a".repeat(40), (...args) => {
    if (args[0] === "log") return `${appCommit}\0Change mobile behavior\0`;
    return "artifacts/brickbuilder-mobile/src/App.tsx\n";
  }), /must contain exactly one/);
});

test("uses only the latest commit as baseline for an initial manual release", () => {
  const calls = [];
  const notes = releaseNotesSince(null, (...args) => {
    calls.push(args);
    return "a".repeat(40) + "\0Publish Android improvements\n\nRelease-Notes-DE: Android-Installation und Teilevorschau wurden verbessert.\0";
  });
  assert.equal(notes, "• Android-Installation und Teilevorschau wurden verbessert.");
  assert.deepEqual(calls[0], ["log", "--first-parent", "-1", "--format=%H%x00%B%x00", "HEAD", "--"]);
});
