// The relationships between the tables a Launch picks (REQ-362). Declared foreign keys come from information_schema, read with the
// person's token; then name matches across the picked tables fill in what no key declares. The run does not read these yet: the
// person's list is kept in the Launch draft, and the agent notebook's own key discovery should later read that list (one source).
const I = require('./inspireImplement');

const RELATIONSHIP_TABLE_LIMIT = 40;
const SOURCE_DECLARED = 'declared key';
const SOURCE_NAME = 'matching column name';
const low = (value) => String(value ?? '').toLowerCase();
const plain = (name) => String(name ?? '').replace(/`/g, '').trim();
const shortOf = (name) => name.split('.').pop();

function splitTable(name) {
  const parts = plain(name).split('.');
  return parts.length === 3 && parts.every((p) => p.trim()) ? parts.map((p) => p.trim()) : null;
}

/** The picked table names the route reads: catalog.schema.table, trimmed, de-duplicated, at most RELATIONSHIP_TABLE_LIMIT. */
function pickedTablesOf(value) {
  if (!Array.isArray(value)) throw I.badRequest('tables must be a list of catalog.schema.table names');
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    const name = plain(raw);
    if (!splitTable(name)) throw I.badRequest(`${name || 'An empty name'} is not a catalog.schema.table name`);
    if (!seen.has(low(name))) { seen.add(low(name)); out.push(name); }
  }
  if (out.length > RELATIONSHIP_TABLE_LIMIT) {
    throw I.badRequest(`Pick at most ${RELATIONSHIP_TABLE_LIMIT} tables to find their relationships; you picked ${out.length}.`);
  }
  return out;
}

/** A plural table name's singular: customers -> customer, categories -> category, addresses -> address, status stays status. */
function singularOf(word) {
  const w = low(word);
  if (w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.endsWith('sses')) return w.slice(0, -2);
  if (w.endsWith('ss') || w.endsWith('us') || w.endsWith('is')) return w;
  return w.endsWith('s') ? w.slice(0, -1) : w;
}

/** The foreign keys one table declares: which of its columns reference which column of which table (the table's own child side). */
function declaredKeysStatement(name) {
  const [c, s, t] = splitTable(name);
  return {
    sql: `SELECT kcu.column_name AS column_name, ccu.table_catalog AS ref_catalog, ccu.table_schema AS ref_schema, `
      + 'ccu.table_name AS ref_table, ccu.column_name AS ref_column '
      + `FROM \`${c}\`.information_schema.key_column_usage kcu `
      + `JOIN \`${c}\`.information_schema.table_constraints tc ON tc.constraint_catalog = kcu.constraint_catalog `
      + 'AND tc.constraint_schema = kcu.constraint_schema AND tc.constraint_name = kcu.constraint_name '
      + `JOIN \`${c}\`.information_schema.constraint_column_usage ccu ON ccu.constraint_catalog = tc.constraint_catalog `
      + 'AND ccu.constraint_schema = tc.constraint_schema AND ccu.constraint_name = tc.constraint_name '
      + "WHERE tc.constraint_type = 'FOREIGN KEY' AND kcu.table_schema = lower(:s) AND kcu.table_name = lower(:t) "
      + 'ORDER BY kcu.ordinal_position',
    parameters: [{ name: 's', value: s, type: 'STRING' }, { name: 't', value: t, type: 'STRING' }],
  };
}

const findName = (list, name) => list.find((x) => low(x) === low(name));

/**
 * One picked table's read: name, columns, primary_keys and its declared foreign keys (rows of declaredKeysStatement).
 * Returns { tables, suggestions }: each table's columns and keys for the pickers, and the relationships between the picked tables.
 */
function relationshipsOf(names, reads) {
  const info = names.map((name, i) => {
    const [cols = [], keys = [], fks = []] = reads[i];
    return {
      name,
      columns: cols.map((r) => String(r.column_name)),
      primary_keys: keys.map((r) => String(r.column_name)),
      declared: fks.filter((r) => r.ref_table),
    };
  });
  const byKey = new Map();
  const add = (from, to, source) => {
    const id = low(`${from.table}.${from.column}>${to.table}.${to.column}`);
    if (!byKey.has(id)) byKey.set(id, { from, to, source });
  };
  for (const t of info) {
    for (const fk of t.declared) {
      const refName = `${fk.ref_catalog}.${fk.ref_schema}.${fk.ref_table}`;
      const target = info.find((o) => low(o.name) === low(refName));
      if (!target) continue;
      const column = String(fk.column_name);
      const refColumn = String(fk.ref_column);
      if (low(t.name) === low(target.name) && low(column) === low(refColumn)) continue;
      add({ table: t.name, column }, { table: target.name, column: findName(target.columns, refColumn) || refColumn }, SOURCE_DECLARED);
    }
  }
  for (const a of info) {
    for (const b of info) {
      if (a === b) continue;
      const want = `${singularOf(shortOf(b.name))}_id`;
      for (const column of a.columns.filter((c) => low(c) === want)) {
        const target = findName(b.columns, column)
          || (b.primary_keys.length === 1 ? b.primary_keys[0] : null)
          || findName(b.columns, 'id');
        if (target) add({ table: a.name, column }, { table: b.name, column: target }, SOURCE_NAME);
      }
      for (const column of a.columns.filter((c) => low(c).endsWith('_id'))) {
        const shared = findName(b.columns, column);
        if (shared && findName(b.primary_keys, column)) add({ table: a.name, column }, { table: b.name, column: shared }, SOURCE_NAME);
      }
    }
  }
  const suggestions = [...byKey.values()].sort((x, y) => (low(`${x.from.table}.${x.from.column}`) < low(`${y.from.table}.${y.from.column}`) ? -1 : 1));
  return {
    tables: Object.fromEntries(info.map((t) => [t.name, { columns: t.columns, primary_keys: t.primary_keys }])),
    suggestions,
  };
}

module.exports = { RELATIONSHIP_TABLE_LIMIT, SOURCE_DECLARED, SOURCE_NAME, pickedTablesOf, singularOf, declaredKeysStatement, relationshipsOf };
