const { parseExactJson } = require('./exactJson');

// The catalogs the installer picked for the App to read, from INSPIRE_DATA_CATALOGS (a JSON list written into app.yaml, REQ-359).
// Anything that is not a non-empty JSON list of names gives null, which means every catalog the person can see.
function installerDataCatalogs(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let parsed;
  try {
    parsed = parseExactJson(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.some((name) => typeof name !== 'string')) return null;
  const names = parsed.map((name) => name.trim()).filter(Boolean);
  return names.length ? names : null;
}

module.exports = { installerDataCatalogs };
