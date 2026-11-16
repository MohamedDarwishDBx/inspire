// The one rule for Inspire's own tables and views in a person's schema (REQ-387). Every list that offers the person's data asks this
// module: Data Management column search and relationships, the Launch table lists (/api/tables), and the App reads naming.
// Each pattern is seeded from a name the agent notebook (dbx_inspire_ai_agent.ipynb) or the backend really creates:
//  - '__inspire_' prefix: __inspire_session, __inspire_step, __inspire_lock, __inspire_usecases, __inspire_feedback (notebook),
//    __inspire_implement (notebook IMPLEMENT_TABLE), __inspire_control_log (backend/lib/implementControl.js),
//    __inspire_profile (backend/lib/businessProfiles.js), __inspire_launch (backend/lib/launchLedger.js).
//  - '_ailogs' exact name: notebook AILOGS_TABLE = "_ailogs".
//  - '__implement_scope' suffix: notebook implement scope views named {base}__{tag}__implement_scope.
//  - '__signal' suffix: notebook companion view of a result table (INSPIRE_COMPANION_DATA_NEEDS "__signal").
// Suffixes are matched exactly, with both underscores, so a person's table named `scope` or `customer_scope` is never hidden.
export const OWN_PREFIX = '__inspire_';
export const OWN_NAMES = new Set(['_ailogs']);
export const OWN_SUFFIXES = ['__implement_scope', '__signal'];

/** True when a table or view name (plain or catalog.schema.table) is one Inspire creates for itself. */
export function isInspireOwnName(name) {
  const plain = String(name ?? '').replace(/`/g, '').split('.').pop().trim().toLowerCase();
  if (!plain) return false;
  return plain.startsWith(OWN_PREFIX) || OWN_NAMES.has(plain) || OWN_SUFFIXES.some((suffix) => plain.endsWith(suffix));
}

/** The same rule as a SQL predicate on one column (false for Inspire's own names). `!` is the LIKE escape, so no backslash reaches SQL. */
export function notInspireOwnSql(column) {
  const lower = `lower(${column})`;
  return `NOT (${lower} LIKE '!_!_inspire!_%' ESCAPE '!' OR ${lower} = '_ailogs' OR ${lower} LIKE '%!_!_implement!_scope' ESCAPE '!' `
    + `OR ${lower} LIKE '%!_!_signal' ESCAPE '!')`;
}
