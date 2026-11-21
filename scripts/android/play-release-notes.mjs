import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const workflowName = "Build and publish closed Google Play test";
const outputDirectory = "generated-artifacts/google-play/whatsnew";

const LANGUAGES = {
  de: { locale: "de-DE", label: "German", trailer: "Release-Notes-DE", completeTrailer: "Release-Notes-DE-Complete" },
  en: { locale: "en-US", label: "English", trailer: "Release-Notes-EN", completeTrailer: "Release-Notes-EN-Complete" },
};
const RELEASE_AUTOMATION_FILES = new Set([
  ".github/workflows/android-google-play.yml",
  "artifacts/brickbuilder-mobile/android/build.gradle",
  "artifacts/brickbuilder-mobile/android/variables.gradle",
  "scripts/android/play-release-notes.mjs",
  "scripts/android/play-release-notes.test.mjs",
]);

/** Every non-merge commit since the previous successful Play release must state its actual user-visible change. */
export function summarizeCommitMessages(messages, language = "de") {
  const locale = LANGUAGES[language];
  if (!locale) throw new Error(`Unsupported release-note language: ${language}`);
  if (!messages.length) {
    throw new Error(`No commits found for this release. Add ${locale.label} release notes or provide them manually.`);
  }
  let lastCompleteIndex = -1;
  let completeSummary = "";
  messages.forEach((message, index) => {
    const subject = message.split(/\r?\n/, 1)[0].trim() || "(commit without subject)";
    const completeNotes = [...message.matchAll(new RegExp(`^${locale.completeTrailer}:\\s*(.*?)\\s*$`, "gim"))];
    if (completeNotes.length > 1) {
      throw new Error(`Commit "${subject}" must contain at most one ${locale.completeTrailer} trailer.`);
    }
    if (completeNotes.length === 1) {
      completeSummary = completeNotes[0][1].trim();
      if (!completeSummary) throw new Error(`Commit "${subject}" has an empty ${locale.completeTrailer} trailer.`);
      lastCompleteIndex = index;
    }
  });
  const notes = [], seen = new Set();
  if (completeSummary) {
    const note = validateNotes(completeSummary, language);
    notes.push(note);
    seen.add(note.replace(/\s+/g, " ").toLocaleLowerCase(locale.locale));
  }
  for (const message of messages.slice(lastCompleteIndex + 1)) {
    const subject = message.split(/\r?\n/, 1)[0].trim() || "(commit without subject)";
    const trailers = [...message.matchAll(new RegExp(`^${locale.trailer}:\\s*(.*?)\\s*$`, "gim"))];
    // Replit task merges can add generated metadata-only commits without user-written trailers.
    if (trailers.length === 0 && /^Replit-Task-Id:\s*\S+/im.test(message) &&
        /^Replit-Merge-Attempt:\s*\S+/im.test(message)) continue;
    if (trailers.length !== 1 || !trailers[0][1].trim()) {
      throw new Error(
        `Commit "${subject}" must contain exactly one "${locale.trailer}: <concrete ${locale.label.toLowerCase()} change>" trailer. ` +
        "Do not substitute a generic summary based only on changed file paths.",
      );
    }
    const note = validateNotes(trailers[0][1], language);
    if (note.includes("\n")) {
      throw new Error(`Release note for "${subject}" must fit on one line.`);
    }
    const key = note.replace(/\s+/g, " ").toLocaleLowerCase(locale.locale);
    if (!seen.has(key)) { seen.add(key); notes.push(note); }
  }
  if (notes.length === 0) throw new Error(`No concrete ${locale.label} release notes found. Add a ${locale.trailer} trailer.`);
  const result = [
    ...(completeSummary ? [notes[0]] : []),
    ...notes.slice(completeSummary ? 1 : 0).map(note => `• ${note}`),
  ].join("\n");
  if ([...result].length > 500) {
    throw new Error(
      `Combined ${locale.label} release notes are ${[...result].length} characters; Google Play allows 500. ` +
      `Shorten or deduplicate the ${locale.trailer} trailers.`,
    );
  }
  return validateNotes(result, language);
}

export function validateNotes(text, language = "de") {
  const locale = LANGUAGES[language];
  if (!locale) throw new Error(`Unsupported release-note language: ${language}`);
  const trimmed = text.trim();
  if (!trimmed || [...trimmed].length > 500) {
    throw new Error(`${locale.label} release notes must contain 1–500 characters.`);
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(trimmed)) {
    throw new Error("Release notes contain unsupported control characters.");
  }
  return trimmed;
}

export async function previousPublishedCommit(env, fetchImpl = fetch) {
  if (!env.GH_TOKEN || !env.GITHUB_REPOSITORY || !env.GITHUB_RUN_NUMBER) {
    throw new Error("GitHub Actions context and GH_TOKEN are required to identify the previous release.");
  }
  const base = env.GITHUB_API_URL || "https://api.github.com";
  for (let page = 1; page <= 10; page += 1) {
    const url = new URL(`${base}/repos/${env.GITHUB_REPOSITORY}/actions/workflows/android-google-play.yml/runs`);
    url.search = new URLSearchParams({
      branch: "android/google-play", status: "success", per_page: "100", page: String(page),
    }).toString();
    const response = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${env.GH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Cannot identify previous published release: GitHub HTTP ${response.status}.`);
    const { workflow_runs: runs } = await response.json();
    if (!Array.isArray(runs)) throw new Error("Unexpected GitHub workflow response.");
    for (const run of runs) {
      // Old build-only workflow successes are not published releases.
      if (run.name !== workflowName || String(run.id) === env.GITHUB_RUN_ID) continue;
      if (Number(run.run_number) > Number(env.GITHUB_RUN_NUMBER)) {
        throw new Error("A newer workflow has already published. Refusing to publish an older version.");
      }
      if (!/^[0-9a-f]{40}$/.test(run.head_sha)) throw new Error("Invalid previous release commit.");
      return run.head_sha;
    }
    if (runs.length < 100) return null;
  }
  throw new Error("Previous published release not found within 1,000 successful runs. Review the release baseline.");
}

export function releaseNotesSince(base, git = (...args) => execFileSync("git", args, { encoding: "utf8" }), language = "de") {
  const locale = LANGUAGES[language];
  if (!locale) throw new Error(`Unsupported release-note language: ${language}`);
  // Follow the Android branch's first-parent history. A merge trailer summarizes
  // imported main changes; traversing its second parent would replay the entire
  // unrelated main history, including commits predating Android releases.
  // Failed Android builds remain on this first-parent path and must be included.
  const output = base
    ? git("log", "--first-parent", "--reverse", "--format=%H%x00%B%x00", `${base}..HEAD`, "--")
    : git("log", "--first-parent", "-1", "--format=%H%x00%B%x00", "HEAD", "--");
  const fields = output.split("\0");
  const messages = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const sha = fields[index].trim();
    const message = fields[index + 1].trim();
    if (!sha || !message) continue;

    const hasReleaseNote = new RegExp(
      `^(?:${locale.trailer}|${locale.completeTrailer}):\\s*\\S`, "im",
    ).test(message);
    if (!hasReleaseNote) {
      const files = git("diff-tree", "--root", "--no-commit-id", "--name-only", "-r", sha, "--")
        .split(/\r?\n/).map(file => file.trim()).filter(Boolean);
      // Build, dependency-scan and release-note maintenance does not belong in
      // Play's user-facing changelog. Keep requiring trailers for app changes.
      if (files.length > 0 && files.every(file => RELEASE_AUTOMATION_FILES.has(file))) continue;
    }
    messages.push(message);
  }
  return summarizeCommitMessages(messages, language);
}

async function main() {
  // Resolve the baseline even for custom notes, to prevent stale-run uploads.
  let base = await previousPublishedCommit(process.env);
  if (!base) {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    if (/^[0-9a-f]{40}$/.test(event.before || "") && !/^0+$/.test(event.before)) base = event.before;
    console.log("No earlier automated Play release: using this push's first commit as the note baseline.");
  }
  const notes = {
    de: process.env.PLAY_RELEASE_NOTES_DE?.trim()
      ? validateNotes(process.env.PLAY_RELEASE_NOTES_DE, "de")
      : releaseNotesSince(base, undefined, "de"),
    en: process.env.PLAY_RELEASE_NOTES_EN?.trim()
      ? validateNotes(process.env.PLAY_RELEASE_NOTES_EN, "en")
      : releaseNotesSince(base, undefined, "en"),
  };
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(`${outputDirectory}/whatsnew-de-DE`, `${notes.de}\n`);
  writeFileSync(`${outputDirectory}/whatsnew-en-US`, `${notes.en}\n`);
  console.log(`German release notes:\n${notes.de}\nEnglish release notes:\n${notes.en}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Google Play release notes · Closed test (alpha)\n\n### German · de-DE\n\n${notes.de}\n\n### English · en-US\n\n${notes.en}\n`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
