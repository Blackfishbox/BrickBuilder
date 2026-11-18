import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const workflowName = "Build and publish closed Google Play test";
const outputDirectory = "generated-artifacts/google-play/whatsnew";

// Summaries describe changed areas, not unverified fixes or translated commit titles.
const areas = [
  [/\/instructions\//i, "Bauanleitungen und PDF-Export überarbeitet."],
  [/\/(?:import|export|inventory)\b|\/formats?\//i, "Import, Export und BrickLink-Teilelisten überarbeitet."],
  [/\/(?:catalog|parts|colors?|color-evidence)\b|ldraw|geometry|thumbnail/i, "Teilesuche, Farben und Geometrien überarbeitet."],
  [/\/(?:engine|connections|editor)\b|snapping|camera|gesture/i, "3D-Bauen, Verbindungen und Touch-Bedienung überarbeitet."],
  [/\/(?:storage|projects|offline)\b|service.worker|indexeddb/i, "Lokale Speicherung und Offline-Nutzung überarbeitet."],
  [/\/privacy\b|privacy[.-]/i, "Datenschutzhinweise aktualisiert."],
  [/\/platform\b|\/android\/|capacitor/i, "Android-Integration und Geräteunterstützung überarbeitet."],
  [/\.github\/workflows\/|scripts\/android\/play-release-notes/i, "Bereitstellung neuer Versionen im geschlossenen Test verbessert."],
  [/\.(?:css|tsx)$/i, "Benutzeroberfläche und Bedienung überarbeitet."],
];

export function summarizeChangedPaths(paths) {
  const remaining = new Set(paths.filter(Boolean));
  const lines = [];
  for (const [pattern, text] of areas) {
    const matches = [...remaining].filter((path) => pattern.test(path));
    if (matches.length) {
      lines.push(text);
      matches.forEach((path) => remaining.delete(path));
    }
  }
  if (remaining.size) lines.push("Weitere Wartungsarbeiten und Aktualisierungen.");
  if (!lines.length) lines.push("Erneute Bereitstellung des aktuellen Stands für den geschlossenen Test.");
  const summary = lines.map((line) => `• ${line}`);
  if ([...summary.join("\n")].length > 500) {
    while (Array.from([...summary, "• Weitere Funktionsbereiche überarbeitet."].join("\n")).length > 500) summary.pop();
    summary.push("• Weitere Funktionsbereiche überarbeitet.");
  }
  return validateNotes(summary.join("\n"));
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

export function changedPaths(base, git = (...args) => execFileSync("git", args, { encoding: "utf8" })) {
  const output = base
    ? git("diff", "--name-only", "-z", base, "HEAD", "--")
    : git("diff-tree", "--root", "--no-commit-id", "--name-only", "-r", "-z", "HEAD");
  return output.split("\0").filter(Boolean);
}

async function main() {
  // Resolve the baseline even for custom notes, to prevent stale-run uploads.
  let base = await previousPublishedCommit(process.env);
  if (!base) {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    if (/^[0-9a-f]{40}$/.test(event.before || "") && !/^0+$/.test(event.before)) base = event.before;
    console.log("No earlier automated Play release: using this push's changes (or HEAD for manual runs).");
  }
  const notes = process.env.PLAY_RELEASE_NOTES_DE?.trim()
    ? validateNotes(process.env.PLAY_RELEASE_NOTES_DE)
    : summarizeChangedPaths(changedPaths(base));
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
