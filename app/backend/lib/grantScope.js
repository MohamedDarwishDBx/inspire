// REQ-408: one rule for the read grants a Permission Required dialog names. A read grant on a table collapses to the schema
// (GRANT SELECT ON SCHEMA c.s, GRANT READ METADATA ON SCHEMA c.s), and USE CATALOG / USE SCHEMA are named once per catalog and schema.
// A whole-catalog pick asks at catalog level instead, and drops the schema and table lines under that catalog. Write privileges
// (MODIFY, CREATE TABLE, CREATE SCHEMA, MANAGE, ...) and every non-UC step pass through exactly. Only Unity Catalog names are read:
// a name in double quotes (a Lakebase Postgres statement) passes through untouched.
const GRANT_RE = /^GRANT\s+(.+?)\s+ON\s+(CATALOG|SCHEMA|TABLE)\s+(.+?)\s+TO\s+(.+?);?$/i;
const NAME_PART = /^(?:`[^`.]+`|[A-Za-z0-9_-]+)$/;
const SHAPE = { CATALOG: 1, SCHEMA: 2, TABLE: 3 };
const READ = new Set(['SELECT', 'READ_METADATA']);

// The parts of a Unity Catalog name, or null when the text is not one (for example a double-quoted Postgres name).
function namePartsOf(text, level) {
  const parts = String(text || '').split('.').map((p) => p.trim());
  if (parts.length !== SHAPE[level] || parts.some((p) => !NAME_PART.test(p))) return null;
  return parts.map((p) => p.replace(/`/g, ''));
}

const quoted = (parts) => parts.map((p) => `\`${p}\``).join('.');

// Returns the statements with read grants coarsened. `wholeCatalogs` lists the catalogs the person picked whole (case-insensitive).
function coarseGrants(statements, { wholeCatalogs = [] } = {}) {
  const whole = new Set((wholeCatalogs || []).map((c) => String(c || '').replace(/`/g, '').trim().toLowerCase()).filter(Boolean));
  const out = new Map();
  const put = (key, text) => { if (!out.has(key)) out.set(key, text); };
  for (const raw of Array.isArray(statements) ? statements : []) {
    const statement = String(raw || '').trim();
    if (!statement) continue;
    const hit = GRANT_RE.exec(statement);
    const privilege = hit && hit[1].trim().toUpperCase().replace(/\s+/g, '_');
    const parts = hit && namePartsOf(hit[3], hit[2].toUpperCase());
    const level = hit && hit[2].toUpperCase();
    const isRead = hit && (READ.has(privilege) && level === 'TABLE' || (privilege === 'USE_SCHEMA' && level === 'SCHEMA')
      || (READ.has(privilege) && level === 'SCHEMA') || (privilege === 'USE_CATALOG' && level === 'CATALOG'));
    if (!hit || !parts || !isRead) {
      put(`raw|${statement}`, statement);
      continue;
    }
    const principal = hit[4].trim();
    const catalog = parts[0];
    const schema = parts[1];
    const who = principal.replace(/`/g, '').trim().toLowerCase();
    if (privilege === 'USE_CATALOG') {
      put(`${who}|USE_CATALOG|${catalog.toLowerCase()}`, `GRANT USE CATALOG ON CATALOG ${quoted([catalog])} TO ${principal}`); // PERMISSION_DIALOG
      continue;
    }
    if (whole.has(catalog.toLowerCase())) {
      // A whole-catalog pick: the catalog gets USE CATALOG and the data grants, and nothing under it stays at schema or table level.
      put(`${who}|USE_CATALOG|${catalog.toLowerCase()}`, `GRANT USE CATALOG ON CATALOG ${quoted([catalog])} TO ${principal}`); // PERMISSION_DIALOG
      if (READ.has(privilege)) put(`${who}|${privilege}|catalog|${catalog.toLowerCase()}`, `GRANT ${privilege.replace('_', ' ')} ON CATALOG ${quoted([catalog])} TO ${principal}`); // PERMISSION_DIALOG
      continue;
    }
    if (privilege === 'USE_SCHEMA') {
      put(`${who}|USE_SCHEMA|${catalog.toLowerCase()}.${schema.toLowerCase()}`, `GRANT USE SCHEMA ON SCHEMA ${quoted([catalog, schema])} TO ${principal}`); // PERMISSION_DIALOG
      continue;
    }
    // SELECT or READ METADATA on a table or a schema: one line per schema.
    put(`${who}|${privilege}|schema|${catalog.toLowerCase()}.${schema.toLowerCase()}`,
      `GRANT ${privilege.replace('_', ' ')} ON SCHEMA ${quoted([catalog, schema])} TO ${principal}`); // PERMISSION_DIALOG
  }
  return [...out.values()];
}

module.exports = { coarseGrants };
