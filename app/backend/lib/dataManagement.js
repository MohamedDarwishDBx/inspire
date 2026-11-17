// The column search of Data Management (REQ-370). One information_schema.columns query per catalog of the picked scope finds the
// columns whose name contains the search text. Metric views are left out (they cannot be filtered), and the answer is capped, so a
// whole-catalog pick never reads every table one at a time.
const I = require('./inspireImplement');
const { notInspireOwnSql } = require('../../frontend/src/lib/inspireOwnObjects.js');

const COLUMN_SEARCH_LIMIT = 300;
const QUERY_MAX = 200;
const METRIC_VIEW_TYPES = "'METRIC_VIEW', 'METRIC VIEW'";

const plain = (name) => String(name ?? '').trim();
const isPlainName = (name) => name.length > 0 && !name.includes('`');

function namesOf(value, label, parts) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw I.badRequest(`${label} must be a list of names`);
  return value.map((raw) => {
    const name = plain(raw);
    const split = name.split('.');
    if (split.length !== parts || !split.every(isPlainName)) throw I.badRequest(`${name || 'An empty name'} is not a ${label} name`);
    return split;
  });
}

/**
 * The search text as an ILIKE pattern (REQ-379). `seg*` finds names that start with seg, `*seg` names that end with it, and `seg` or
 * `*seg*` names that contain it. Case is ignored by ILIKE. A % _ or \\ in the text matches itself. Text that is only stars names
 * nothing, so it returns null.
 */
function likePatternOf(text) {
  let core = String(text ?? '').trim();
  const lead = core.startsWith('*');
  if (lead) core = core.slice(1);
  const trail = core.endsWith('*');
  if (trail) core = core.slice(0, -1);
  core = core.trim();
  if (!core) return null;
  const literal = core.replace(/[\\%_]/g, (m) => `\\${m}`);
  if (trail && !lead) return `${literal}%`;
  if (lead && !trail) return `%${literal}`;
  return `%${literal}%`;
}

/**
 * The search statements for a picked scope ({ catalogs, schemas, tables } as names), one per catalog that has a pick. A catalog picked
 * whole is searched whole; a schema or a table narrows the search to its tables. `q` is bound as a parameter, never written into the SQL.
 */
function columnSearchStatements(scope, q) {
  const picks = new Map();
  const of = (catalog) => {
    if (!picks.has(catalog)) picks.set(catalog, { whole: false, schemas: [], tables: [] });
    return picks.get(catalog);
  };
  for (const [catalog] of namesOf(scope?.catalogs, 'catalog', 1)) of(catalog).whole = true;
  for (const [catalog, schema] of namesOf(scope?.schemas, 'schema', 2)) of(catalog).schemas.push(schema);
  for (const [catalog, schema, table] of namesOf(scope?.tables, 'table', 3)) of(catalog).tables.push([schema, table]);
  const pattern = likePatternOf(q);
  if (pattern === null) return [];
  return [...picks.entries()].filter(([, p]) => p.whole || p.schemas.length || p.tables.length).map(([catalog, p]) => {
    const parameters = [{ name: 'q', value: pattern, type: 'STRING' }];
    const clauses = [];
    p.schemas.forEach((schema, i) => {
      parameters.push({ name: `s${i}`, value: schema, type: 'STRING' });
      clauses.push(`c.table_schema = lower(:s${i})`);
    });
    p.tables.forEach(([schema, table], i) => {
      parameters.push({ name: `ts${i}`, value: schema, type: 'STRING' }, { name: `tt${i}`, value: table, type: 'STRING' });
      clauses.push(`(c.table_schema = lower(:ts${i}) AND c.table_name = lower(:tt${i}))`);
    });
    const scopeSql = p.whole ? 'TRUE' : clauses.join(' OR ');
    return {
      catalog,
      statement: {
        sql: 'SELECT c.table_schema, c.table_name, c.column_name, c.data_type, COUNT(*) OVER () AS total '
          + `FROM \`${catalog}\`.information_schema.columns c `
          + `JOIN \`${catalog}\`.information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name `
          + `WHERE c.column_name ILIKE :q AND t.table_type NOT IN (${METRIC_VIEW_TYPES}) AND (${scopeSql}) AND ${notInspireOwnSql('c.table_name', 'c.table_schema')} `
          + `ORDER BY c.column_name, c.table_schema, c.table_name LIMIT ${COLUMN_SEARCH_LIMIT}`,
        parameters,
      },
    };
  });
}

/** Merge the per-catalog rows into one answer: the first COLUMN_SEARCH_LIMIT hits in name order, and the total of every match. */
function mergeColumnHits(parts, limit = COLUMN_SEARCH_LIMIT) {
  let total = 0;
  const rows = [];
  for (const { catalog, rows: got } of parts) {
    if (got.length) total += Number(got[0].total) || got.length;
    for (const r of got) rows.push({ table: `${catalog}.${r.table_schema}.${r.table_name}`, column: String(r.column_name), data_type: String(r.data_type || '') });
  }
  rows.sort((a, b) => a.column.localeCompare(b.column) || a.table.localeCompare(b.table));
  return { hits: rows.slice(0, limit), total };
}

/** The search text, trimmed and bounded. Empty text searches nothing. */
function queryOf(value) {
  const q = plain(value);
  if (q.length > QUERY_MAX) throw I.badRequest(`Search up to ${QUERY_MAX} characters.`);
  return q;
}

module.exports = { COLUMN_SEARCH_LIMIT, QUERY_MAX, columnSearchStatements, likePatternOf, mergeColumnHits, queryOf };
