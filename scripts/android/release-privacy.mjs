const fields = [
  ["PRIVACY_CONTROLLER_NAME", "[Name des Verantwortlichen]"],
  ["PRIVACY_CONTROLLER_STREET", "[Straße und Hausnummer]"],
  ["PRIVACY_CONTROLLER_POSTAL_CITY", "[Postleitzahl und Ort]"],
  ["PRIVACY_CONTROLLER_COUNTRY", "[Land]"],
];

const escapeHtml = value => value.replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

/** Only generated release assets receive personal data; never mutate the source. */
export function renderReleasePrivacy(template, environment) {
  let result = template;
  for (const [key, placeholder] of fields) {
    const value = environment[key]?.trim();
    if (!value || value.length > 300 || /[\u0000-\u001f\u007f]/.test(value) ||
        /^\[.*\]$/.test(value)) {
      // Never include a supplied value in logs or exceptions.
      throw new Error(`Missing or invalid release secret: ${key}`);
    }
    if (result.split(placeholder).length !== 2) {
      throw new Error(`Expected exactly one privacy placeholder for ${key}`);
    }
    result = result.replace(placeholder, () => escapeHtml(value));
  }
  return result;
}
