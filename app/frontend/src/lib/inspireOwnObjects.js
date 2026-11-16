// The one rule for Inspire's own tables and views in a person's schema (REQ-387). Every list that offers the person's data asks this
// module: Data Management column search and relationships, the Launch table lists (/api/tables), the App reads naming, the backend
// catalog list. Each pattern is the naming the agent notebook (dbx_inspire_ai_agent.ipynb) really gives an object:
//  - table prefix '__inspire_': the tracking and control tables (__inspire_session, __inspire_step, __inspire_lock, __inspire_usecases,
//    __inspire_feedback, __inspire_implement = IMPLEMENT_TABLE, __inspire_control_log, __inspire_profile, __inspire_launch) and the app
//    feedback tables (INSPIRE_APP_FEEDBACK_PREFIX '__inspire_app_feedback_').
//  - table prefix '_inspire_': a result table of the Inspire database (compute_result_table_name: `_inspire_<id>_<name>[_s<session>]`),
//    and the temp views and queues Inspire makes (_tracking_unique_view `_inspire_<prefix>_<session>_<n>`, `_inspire_ai_<hex>`).
//  - exact '_ailogs' (AILOGS_TABLE).
//  - suffix '__implement_scope', then optionally '__candidate' (CANDIDATE_VIEW_SUFFIX) and '__v<N>' (_implement_view_suffix): the Table
//    Scope view of a use case, named `<catalog>_<schema>_<table>__<tag>__implement_scope` (implement_table_scopes, scope_named).
//  - schema prefix '_inspire_': a use case's own result schema (inspire_use_case_schema_name: `_inspire_<business>_<use case>`). Its
//    result tables and companions (`<id>_results`, `<id>_results__signal`, `..__lb_changes`, ...) are all Inspire's.
// The schema `_inspire` itself is the Inspire database, not a prefix: a plain table in it is the person's data (REQ-387).
// A sample copy the App makes (`<schema>.bakehouse__sales_transactions`) and any table named by the person stay listed.
// The regex is written without a backslash or a quote, so the same text is a Databricks RLIKE pattern in notebookless SQL.
export const OWN_TABLE_PATTERN = '^__?inspire_|^_ailogs$|__implement_scope(__candidate)?(__v[0-9]+)?$';
export const OWN_SCHEMA_PATTERN = '^_inspire_';
const OWN_TABLE_RE = new RegExp(OWN_TABLE_PATTERN);
const OWN_SCHEMA_RE = new RegExp(OWN_SCHEMA_PATTERN);

/** True when a table or view name (plain, schema.table or catalog.schema.table) is one Inspire creates for itself. */
export function isInspireOwnName(name) {
  const parts = String(name ?? '').replace(/`/g, '').split('.').map((p) => p.trim().toLowerCase());
  const table = parts[parts.length - 1];
  if (!table) return false;
  const schema = parts.length >= 2 ? parts[parts.length - 2] : '';
  return OWN_TABLE_RE.test(table) || OWN_SCHEMA_RE.test(schema);
}

/** The same rule as a SQL predicate: NOT (...) over the table column and, when given, the schema column. Case-insensitive via lower(). */
export function notInspireOwnSql(tableColumn, schemaColumn) {
  const clauses = [`lower(${tableColumn}) RLIKE '${OWN_TABLE_PATTERN}'`];
  if (schemaColumn) clauses.push(`lower(${schemaColumn}) RLIKE '${OWN_SCHEMA_PATTERN}'`);
  return `NOT (${clauses.join(' OR ')})`;
}
