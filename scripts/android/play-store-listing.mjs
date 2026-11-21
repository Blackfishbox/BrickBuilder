import { createSign } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const API_ROOT = "https://androidpublisher.googleapis.com/androidpublisher/v3";
const PACKAGE_NAME = "brickbuilder.blackfishbox.de";
const LANGUAGE = "en-US";
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

export function validateListing(listing) {
  const limits = { title: 30, shortDescription: 80, fullDescription: 4000 };
  const normalized = {};
  for (const [field, limit] of Object.entries(limits)) {
    const value = listing[field]?.trim();
    if (!value) throw new Error(`English Play Store listing field "${field}" is empty.`);
    if ([...value].length > limit) {
      throw new Error(`English Play Store listing field "${field}" exceeds ${limit} characters.`);
    }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) {
      throw new Error(`English Play Store listing field "${field}" contains unsupported control characters.`);
    }
    normalized[field] = value;
  }
  return normalized;
}

export function loadEnglishListing(directory = resolve(ROOT, "play-store-listing/en-US")) {
  const listing = {
    title: readFileSync(resolve(directory, "title.txt"), "utf8"),
    shortDescription: readFileSync(resolve(directory, "short-description.txt"), "utf8"),
    fullDescription: readFileSync(resolve(directory, "full-description.txt"), "utf8"),
  };
  return validateListing(listing);
}

function parseServiceAccount(json) {
  let account;
  try { account = JSON.parse(json); }
  catch { throw new Error("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not valid JSON."); }
  if (account?.type !== "service_account" || !account.client_email || !account.private_key || !account.token_uri) {
    throw new Error("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON must contain service-account email, private key and token URI.");
  }
  let tokenUrl;
  try { tokenUrl = new URL(account.token_uri); }
  catch { throw new Error("The service-account token URI is invalid."); }
  if (tokenUrl.origin !== "https://oauth2.googleapis.com" || tokenUrl.pathname !== "/token"
      || tokenUrl.username || tokenUrl.password || tokenUrl.search || tokenUrl.hash) {
    throw new Error("The service-account token URI must be Google's HTTPS OAuth endpoint.");
  }
  return account;
}

async function createAccessToken(account, fetchImpl, now = Math.floor(Date.now() / 1000)) {
  const header = encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = encodeBase64Url(JSON.stringify({
    iss: account.client_email,
    scope: SCOPE,
    aud: account.token_uri,
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(account.private_key).toString("base64url")}`;
  const response = await fetchImpl(account.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Google OAuth token request failed (HTTP ${response.status}).`);
  const token = await response.json();
  if (typeof token.access_token !== "string" || !token.access_token) {
    throw new Error("Google OAuth returned no access token.");
  }
  return token.access_token;
}

async function apiRequest(fetchImpl, accessToken, url, { method = "GET", body, allowNotFound = false } = {}) {
  const response = await fetchImpl(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (allowNotFound && response.status === 404) return null;
  if (!response.ok) {
    const permissionHint = response.status === 403
      ? " Check that the service account can manage this app's store listing."
      : "";
    throw new Error(`Google Play API request failed (HTTP ${response.status}).${permissionHint}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function listingUrl(editId) {
  return `${API_ROOT}/applications/${encodeURIComponent(PACKAGE_NAME)}/edits/${encodeURIComponent(editId)}/listings/${LANGUAGE}`;
}

export async function prepareEnglishListingEdit({
  serviceAccountJson,
  listing,
  fetchImpl = fetch,
  now,
}) {
  if (!serviceAccountJson?.trim()) throw new Error("Missing GOOGLE_PLAY_SERVICE_ACCOUNT_JSON.");
  const desired = validateListing(listing);
  const account = parseServiceAccount(serviceAccountJson);
  const accessToken = await createAccessToken(account, fetchImpl, now);
  const baseUrl = `${API_ROOT}/applications/${encodeURIComponent(PACKAGE_NAME)}/edits`;
  const edit = await apiRequest(fetchImpl, accessToken, baseUrl, { method: "POST", body: {} });
  const editId = typeof edit?.id === "string" ? edit.id : "";
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(editId)) throw new Error("Google Play did not return a valid edit ID.");
    const url = listingUrl(editId);
    const current = await apiRequest(fetchImpl, accessToken, url, { allowNotFound: true });
    const unchanged = current?.title === desired.title
      && current?.shortDescription === desired.shortDescription
      && current?.fullDescription === desired.fullDescription;
    if (unchanged) {
      return { editId, changed: false };
    }

    const updatedListing = {
      language: LANGUAGE,
      title: desired.title,
      shortDescription: desired.shortDescription,
      fullDescription: desired.fullDescription,
      ...(current?.video ? { video: current.video } : {}),
    };
    await apiRequest(fetchImpl, accessToken, url, { method: "PUT", body: updatedListing });
    return { editId, changed: true };
  } catch (error) {
    if (editId) {
      try {
        await apiRequest(fetchImpl, accessToken, baseUrl + `/${encodeURIComponent(editId)}`, {
          method: "DELETE",
          allowNotFound: true,
        });
      } catch {
        // Preserve the original failure; an abandoned edit expires automatically.
      }
    }
    throw error;
  }
}

export async function discardPlayEdit({ serviceAccountJson, editId, fetchImpl = fetch }) {
  if (!serviceAccountJson?.trim()) throw new Error("Missing GOOGLE_PLAY_SERVICE_ACCOUNT_JSON.");
  if (!editId || !/^[A-Za-z0-9_-]+$/.test(editId)) throw new Error("Invalid Google Play edit ID.");
  const account = parseServiceAccount(serviceAccountJson);
  const accessToken = await createAccessToken(account, fetchImpl);
  const url = `${API_ROOT}/applications/${encodeURIComponent(PACKAGE_NAME)}/edits/${encodeURIComponent(editId)}`;
  await apiRequest(fetchImpl, accessToken, url, { method: "DELETE", allowNotFound: true });
}

async function main() {
  if (process.argv.includes("--discard")) {
    await discardPlayEdit({
      serviceAccountJson: process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON,
      editId: process.env.GOOGLE_PLAY_EDIT_ID,
    });
    console.log("Discarded the unused Google Play edit.");
    return;
  }
  if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required to pass the prepared Play edit to the release upload.");
  const prepared = await prepareEnglishListingEdit({
    serviceAccountJson: process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON,
    listing: loadEnglishListing(),
  });
  appendFileSync(process.env.GITHUB_OUTPUT, `edit_id=${prepared.editId}\n`);
  const summary = prepared.changed
    ? "English Google Play listing text was added or updated."
    : "English Google Play listing text already matches the versioned source.";
  console.log(prepared.changed
    ? "Prepared the English Google Play store listing in the release edit."
    : "The English listing already matches; the existing Play edit is ready for the release upload.");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## English Google Play listing\n\n${summary}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
