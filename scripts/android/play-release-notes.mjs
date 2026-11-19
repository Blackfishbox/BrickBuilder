import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const workflowName = "Build and publish closed Google Play test";
const outputDirectory = "generated-artifacts/google-play/whatsnew";

const RELEASE_NOTE_TRAILER = "Release-Notes-DE";

/** Every non-merge commit since the previous successful Play release must state its actual user-visible change. */
export function summarizeCommitMessages(messages) {
  if (!messages.length) {
    throw new Error("No commits found for this release. Add German release notes or provide them manually.");
  }
  const notes = [], seen = new Set();
  for (const message of messages) {
    const subject = message.split(/\r?\n/, 1)[0].trim() || "(commit without subject)";
    const trailers = [...message.matchAll(/^Release-Notes-DE:\s*(.*?)\s*$/gim)];
    // Replit task merges can add generated metadata-only commits without user-written trailers.
    if (trailers.length === 0 && /^Replit-Task-Id:\s*\S+/im.test(message) &&
        /^Replit-Merge-Attempt:\s*\S+/im.test(message)) continue;
    if (trailers.length !== 1 || !trailers[0][1].trim()) {
      throw new Error(
        `Commit "${subject}" must contain exactly one "${RELEASE_NOTE_TRAILER}: <konkrete deutsche Änderung>" trailer. ` +
        "Do not substitute a generic summary based only on changed file paths.",
      );
    }
    const note = validateNotes(trailers[0][1]);
    if (note.includes("\n")) {
      throw new Error(`Release note for "${subject}" must fit on one line.`);
    }
    const key = note.replace(/\s+/g, " ").toLocaleLowerCase("de-DE");
    if (!seen.has(key)) { seen.add(key); notes.push(note); }
  }
  if (notes.length === 0) throw new Error("No concrete German release notes found. Add a Release-Notes-DE trailer.");
  const result = notes.map(note => `• ${note}`).join("\n");
  if ([...result].length > 500) {
    throw new Error(
      `Combined German release notes are ${[...result].length} characters; Google Play allows 500. ` +
      "Shorten or deduplicate the commit trailers.",
    );
  }
  return validateNotes(result);
}

export function validateNotes(text) {
  const trimmed = text.trim();
  if (!trimmed || [...trimmed].length > 500) {
    throw new Error("German release notes must contain 1–500 characters.");
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

export function releaseNotesSince(base, git = (...args) => execFileSync("git", args, { encoding: "utf8" })) {
  // Follow the Android branch's first-parent history. A merge trailer summarizes
  // imported main changes; traversing its second parent would replay the entire
  // unrelated main history, including commits predating Android releases.
  // Failed Android builds remain on this first-parent path and must be included.
  const output = base
    ? git("log", "--first-parent", "--reverse", "--format=%B%x00", `${base}..HEAD`, "--")
    : git("log", "--first-parent", "-1", "--format=%B%x00", "HEAD", "--");
  return summarizeCommitMessages(output.split("\0").map(message => message.trim()).filter(Boolean));
}

async function main() {
  // Resolve the baseline even for custom notes, to prevent stale-run uploads.
  let base = await previousPublishedCommit(process.env);
  if (!base) {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    if (/^[0-9a-f]{40}$/.test(event.before || "") && !/^0+$/.test(event.before)) base = event.before;
    console.log("No earlier automated Play release: using this push's first commit as the note baseline.");
  }
  const notes = process.env.PLAY_RELEASE_NOTES_DE?.trim()
    ? validateNotes(process.env.PLAY_RELEASE_NOTES_DE)
    : releaseNotesSince(base);
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(`${outputDirectory}/whatsnew-de-DE`, `${notes}\n`);
  console.log(`German release notes:\n${notes}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Versionshinweise · Geschlossener Test (alpha)\n\n${notes}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
