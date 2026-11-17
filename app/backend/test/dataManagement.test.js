// REQ-370: Data Management on a large pick. The column search is one information_schema.columns query per catalog (capped, metric views
// left out, no per-table reads); the relationships are read for one picked table. The routes run against a fake warehouse with 550 tables.
const test = require('node:test');
const assert = require('node:assert/strict');
const DM = require('../lib/dataManagement');
const { makeApp, listen } = require('./support/implementApp');

const VIEW = 'main.s.customer_value_metrics';
const Q = 'warehouse_id=wh1';

// 550 tables in main.s (plus one metric view), each with an id column and a `brand` column on every fifth table.
const TABLES = Array.from({ length: 550 }, (_, i) => `main.s.t${i}`);
const COLUMNS = Object.fromEntries(TABLES.map((t, i) => [t, [
  { column_name: 'id', data_type: 'BIGINT' }, { column_name: `t${i}_id`, data_type: 'BIGINT' },
  ...(i % 5 === 0 ? [{ column_name: 'brand', data_type: 'STRING' }] : []),
]]));
const OTHER = { catalog: 'other', table: 'other.x.brand_table', columns: [{ column_name: 'brand', data_type: 'STRING' }] };

// A fake warehouse for the search: it answers the ILIKE statement from the fixture, as Databricks would (the scope is read from the
// statement's own parameters, and a whole-catalog statement is TRUE within its catalog).
function fakeSearch(sql, parameters) {
  // The pattern decides the match the way ILIKE does: a leading % is "ends with", a trailing % is "starts with", both is "contains".
  const raw = parameters.find((p) => p.name === 'q').value;
  const leading = raw.startsWith('%');
  const trailing = raw.endsWith('%') && !raw.endsWith('\\%');
  const pattern = raw.slice(leading ? 1 : 0, trailing ? -1 : undefined).replace(/\\([\\%_])/g, '$1').toLowerCase();
  const matches = (name) => {
    if (leading && trailing) return name.includes(pattern);
    if (leading) return name.endsWith(pattern);
    if (trailing) return name.startsWith(pattern);
    return name.includes(pattern);
  };
  const catalog = (/FROM `([^`]+)`\.information_schema\.columns/.exec(sql) || [])[1];
  const schemas = parameters.filter((p) => /^s\d+$/.test(p.name)).map((p) => p.value);
  const pairs = parameters.filter((p) => /^ts\d+$/.test(p.name)).map((p, i) => [p.value, parameters.find((x) => x.name === `tt${i}`).value]);
  const whole = sql.includes('(TRUE)');
  const inScope = (schema, table) => whole || schemas.includes(schema) || pairs.some(([s, t]) => s === schema && t === table);
  const rows = [];
  for (const [name, cols] of Object.entries(COLUMNS).concat([[OTHER.table, OTHER.columns]])) {
    const [c, schema, table] = name.split('.');
    if (c !== catalog || !inScope(schema, table)) continue;
    for (const col of cols) {
      if (matches(col.column_name.toLowerCase())) rows.push({ table_schema: schema, table_name: table, column_name: col.column_name, data_type: col.data_type });
    }
  }
  return rows.slice(0, 300).map((r) => ({ ...r, total: rows.length }));
}

const search = (scope, q) => ({ scope, q });

test('the column search is one statement per catalog: a whole catalog is searched whole, metric views are left out, and q is bound', () => {
  const got = DM.columnSearchStatements({ catalogs: ['main'], schemas: [], tables: [] }, 'brand');
  assert.equal(got.length, 1);
  assert.match(got[0].statement.sql, /c\.column_name ILIKE :q/);
  assert.match(got[0].statement.sql, /t\.table_type NOT IN \('METRIC_VIEW', 'METRIC VIEW'\)/);
  assert.match(got[0].statement.sql, /LIMIT 300/);
  assert.doesNotMatch(got[0].statement.sql, /brand/, 'the search text is bound as a parameter, never written into the SQL');
  assert.deepEqual(got[0].statement.parameters.map((p) => [p.name, p.value]), [['q', '%brand%']]);
});

test('a schema or a table pick narrows the search to its tables, and one catalog gives one statement', () => {
  const got = DM.columnSearchStatements({ catalogs: [], schemas: ['main.s'], tables: ['main.s.t1', 'other.x.brand_table'] }, 'brand');
  assert.deepEqual(got.map((g) => g.catalog), ['main', 'other']);
  assert.match(got[0].statement.sql, /c\.table_schema = lower\(:s0\) OR \(c\.table_schema = lower\(:ts0\) AND c\.table_name = lower\(:tt0\)\)/);
  assert.doesNotMatch(got[0].statement.sql, /TRUE/, 'a narrowed pick is not searched whole');
});

test('the search text is escaped for ILIKE, so % and _ in a name match themselves', () => {
  const got = DM.columnSearchStatements({ catalogs: ['main'] }, '50%_off');
  assert.equal(got[0].statement.parameters[0].value, '%50\\%\\_off%');
});

test('an empty search reads nothing, and a search text over 200 characters is refused', () => {
  assert.equal(DM.queryOf('   '), '');
  assert.throws(() => DM.queryOf('x'.repeat(201)), /Search up to 200 characters/);
});

test('a bad scope name is refused by name, and a backtick in a name is never written into the SQL', () => {
  assert.throws(() => DM.columnSearchStatements({ tables: ['main.s'] }, 'a'), /is not a table name/);
  assert.throws(() => DM.columnSearchStatements({ catalogs: ['ma`in'] }, 'a'), /is not a catalog name/);
});

test('the merged answer caps the hits at 300 in column-name order and reports every match', () => {
  const rows = Array.from({ length: 400 }, (_, i) => ({ table_schema: 's', table_name: `t${i}`, column_name: `brand_${String(i).padStart(3, '0')}`, data_type: 'STRING', total: '400' }));
  const got = DM.mergeColumnHits([{ catalog: 'main', rows }]);
  assert.equal(got.hits.length, 300);
  assert.equal(got.total, 400, 'the total is every match, so the person sees 300 of 400');
  assert.equal(got.hits[0].table, 'main.s.t0');
  assert.deepEqual(DM.mergeColumnHits([]), { hits: [], total: 0 });
});

test('POST /api/data-management/columns answers from ONE query over a 550-table catalog, capped at 300 with the total', async () => {
  const made = makeApp({ statements: { 'ILIKE :q': (sql, parameters) => ({ rows: fakeSearch(sql, parameters) }) } });
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}/api/data-management/columns?${Q}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-email': 'owner@example.com' },
      body: JSON.stringify(search({ catalogs: ['main'], schemas: [], tables: [] }, 'brand')) });
    const got = await resp.json();
    assert.equal(resp.status, 200, JSON.stringify(got));
    const searches = made.sqlCalls.filter((c) => /ILIKE :q/.test(c.sql));
    assert.equal(searches.length, 1, 'one query for the whole catalog, not one per table');
    assert.equal(got.total, 110, '110 tables have a brand column');
    assert.equal(got.hits.length, 110, 'all of them fit under the cap');
    assert.equal(got.hits[0].table, 'main.s.t0');
    assert.equal(got.hits[0].column, 'brand');
  } finally {
    srv.close?.();
  }
});

test('an empty search answers at once with no hits and runs no query', async () => {
  const made = makeApp({});
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}/api/data-management/columns?${Q}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-email': 'owner@example.com' },
      body: JSON.stringify(search({ catalogs: ['main'] }, '  ')) });
    const got = await resp.json();
    assert.equal(resp.status, 200);
    assert.deepEqual(got.hits, []);
    assert.equal(made.sqlCalls.filter((c) => /information_schema/.test(c.sql)).length, 0);
  } finally {
    srv.close?.();
  }
});

test('POST /api/relationships reads one table: a metric view is named back and nothing else is read', async () => {
  const made = makeApp({ metricViews: [VIEW] });
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}/api/relationships?${Q}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-email': 'owner@example.com' },
      body: JSON.stringify({ table: VIEW, tables: [VIEW, 'main.s.orders'] }) });
    const got = await resp.json();
    assert.equal(resp.status, 200, JSON.stringify(got));
    assert.deepEqual(got.metric_views, [VIEW]);
    assert.deepEqual(got.suggestions, []);
    assert.equal(made.sqlCalls.filter((c) => /key_column_usage|information_schema\.columns/.test(c.sql)).length, 0);
  } finally {
    srv.close?.();
  }
});

test('POST /api/relationships over a 550-table scope reads the columns in one query per catalog, not per table', async () => {
  const made = makeApp({ statements: { "constraint_type = 'PRIMARY KEY'": () => ({ rows: [] }), 'table_schema = lower(:s0)': (sql, parameters) => {
    const picked = parameters.filter((p) => /^s\d+$/.test(p.name)).map((p, i) => `main.${p.value}.${parameters.find((x) => x.name === `t${i}`).value}`);
    return { rows: picked.filter((n) => COLUMNS[n]).flatMap((n) => COLUMNS[n].map((c) => ({ table_schema: 's', table_name: n.split('.')[2], column_name: c.column_name }))) };
  } } });
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}/api/relationships?${Q}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-email': 'owner@example.com' },
      body: JSON.stringify({ table: 'main.s.t3', tables: TABLES }) });
    const got = await resp.json();
    assert.equal(resp.status, 200, JSON.stringify(got));
    // The scope read: the picked-scope OR clause, then the Inspire-own-name predicate (REQ-387).
    const scopeReads = made.sqlCalls.filter((c) => /information_schema\.columns WHERE \(\(table_schema/.test(c.sql));
    assert.equal(scopeReads.length, 1, 'one query over the whole picked scope');
    assert.equal(Object.keys(got.tables).length, 550, 'every picked table comes back with its columns, for the pickers');
    assert.equal(got.tables['main.s.t3'].columns.length, 2);
  } finally {
    srv.close?.();
  }
});

// The primary-key fallback reaches the route (REQ-370): orders.customer_id links to customers.customer_no, the customers primary key.
test('POST /api/relationships links a child column to a target primary key with another name, through the scope queries', async () => {
  const fixture = { 'main.s.orders': ['order_id', 'customer_id'], 'main.s.customers': ['customer_no', 'name'] };
  const keys = { 'main.s.customers': ['customer_no'] };
  const pairs = (parameters) => parameters.filter((p) => /^s\d+$/.test(p.name)).map((p, i) => `main.${p.value}.${parameters.find((x) => x.name === `t${i}`).value}`);
  const made = makeApp({ statements: {
    "constraint_type = 'PRIMARY KEY'": (sql, parameters) => ({ rows: pairs(parameters).filter((n) => keys[n])
      .flatMap((n) => keys[n].map((c) => ({ table_schema: 's', table_name: n.split('.')[2], column_name: c }))) }),
    'table_schema = lower(:s0)': (sql, parameters) => ({ rows: pairs(parameters).filter((n) => fixture[n])
      .flatMap((n) => fixture[n].map((c) => ({ table_schema: 's', table_name: n.split('.')[2], column_name: c }))) }),
  } });
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}/api/relationships?${Q}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-email': 'owner@example.com' },
      body: JSON.stringify({ table: 'main.s.orders', tables: ['main.s.orders', 'main.s.customers'] }) });
    const got = await resp.json();
    assert.equal(resp.status, 200, JSON.stringify(got));
    assert.deepEqual(got.suggestions, [{ from: { table: 'main.s.orders', column: 'customer_id' }, to: { table: 'main.s.customers', column: 'customer_no' }, source: 'matching column name' }]);
    assert.deepEqual(got.tables['main.s.customers'].primary_keys, ['customer_no'], 'the other table carries its own primary key');
  } finally {
    srv.close?.();
  }
});

// Measurement (REQ-370, the payload of one relationships answer): 550 tables of 30 columns, names of typical length.
test('the relationships answer for a 550-table pick of 30 columns each is measured, and stays under the 2 MB cap', async () => {
  const names = Array.from({ length: 550 }, (_, i) => `main.s.table_${String(i).padStart(3, '0')}`);
  const cols = Array.from({ length: 30 }, (_, c) => `column_attribute_${String(c).padStart(2, '0')}`);
  const rows = names.flatMap((n) => cols.map((c) => ({ table_schema: 's', table_name: n.split('.')[2], column_name: c })));
  const made = makeApp({ statements: {
    "constraint_type = 'PRIMARY KEY'": () => ({ rows: [] }),
    'table_schema = lower(:s0)': () => ({ rows }),
  } });
  const srv = await listen(made.app);
  try {
    const body = JSON.stringify({ table: names[3], tables: names });
    const resp = await fetch(`${srv.url}/api/relationships?${Q}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-email': 'owner@example.com' }, body });
    const text = await resp.text();
    const got = JSON.parse(text);
    console.log(`[measure] scope rows=${rows.length} scope query bytes(JSON)=${Buffer.byteLength(JSON.stringify(rows))} response bytes=${Buffer.byteLength(text)} tables sent=${Object.keys(got.tables).length}/${names.length} columns_note=${got.columns_note ? 'yes' : 'no'}`);
    assert.ok(Buffer.byteLength(text) <= R2_LIMIT, 'the answer is under the cap');
    assert.equal(Object.keys(got.tables).length, 550, 'every table fits in this shape, so no note');
  } finally {
    srv.close?.();
  }
});
const R2_LIMIT = 2 * 1024 * 1024;

// REQ-379: the wildcards of the column search. `seg*` starts with seg, `*seg` ends with it, `seg` or `*seg*` contains it, and ILIKE
// ignores case. A literal _ in a name is a literal, so *_id finds customer_id and never customerXid.
// likeMatch reads a pattern the way Databricks ILIKE does (the escape is a backslash), so the cases below test the matching itself.
function likeMatch(name, pattern) {
  let re = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '\\' && i + 1 < pattern.length) { re += pattern[i + 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); i += 1; }
    else if (ch === '%') re += '.*';
    else if (ch === '_') re += '.';
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`${re}$`, 'is').test(name);
}
const NAMES = ['customer_id', 'customerXid', 'seg_total', 'total_seg', 'SEG_upper', 'segment', 'brand'];
const matchedBy = (text) => NAMES.filter((n) => likeMatch(n, DM.likePatternOf(text))).sort();

test('each wildcard shape matches the names it should and only those (must-keep, must-exclude)', () => {
  assert.deepEqual(matchedBy('seg*'), ['SEG_upper', 'seg_total', 'segment'], 'seg* starts with seg, ignoring case');
  assert.deepEqual(matchedBy('*seg'), ['total_seg'], '*seg ends with seg, ignoring case: only total_seg ends in it');
  assert.deepEqual(matchedBy('seg'), ['SEG_upper', 'seg_total', 'segment', 'total_seg'].sort(), 'a bare word contains it');
  assert.deepEqual(matchedBy('*seg*'), matchedBy('seg'), 'the star at both ends is the same as a bare word');
  assert.equal(DM.likePatternOf('seg*'), 'seg%', 'the starts-with pattern has no leading %');
  assert.equal(DM.likePatternOf('*seg'), '%seg', 'the ends-with pattern has no trailing %');
  assert.equal(DM.likePatternOf('seg'), '%seg%');
});

test('an underscore in the search is a literal, so *_id matches customer_id and not customerXid (must-exclude)', () => {
  assert.equal(DM.likePatternOf('*_id'), '%\\_id');
  assert.deepEqual(matchedBy('*_id'), ['customer_id']);
  assert.deepEqual(matchedBy('cust_*'), [], 'cust_* is cust then a literal underscore, and no name has an underscore after cust');
  assert.deepEqual(matchedBy('cust*'), ['customer_id', 'customerXid'].sort(), 'cust* starts with cust');
});

test('text made only of stars names nothing, and a percent sign in a name is a literal (must-exclude)', () => {
  assert.equal(DM.likePatternOf('*'), null);
  assert.equal(DM.likePatternOf('**'), null);
  assert.deepEqual(DM.columnSearchStatements({ catalogs: ['main'] }, '*'), [], 'a bare star reads nothing');
  assert.equal(DM.likePatternOf('50%*'), '50\\%%');
  assert.equal(DM.likePatternOf('*50%'), '%50\\%');
});

test('POST /api/data-management/columns honours the wildcards: seg* answers names that start with seg, not names that contain it', async () => {
  const made = makeApp({ statements: { 'ILIKE :q': (sql, parameters) => ({ rows: fakeSearch(sql, parameters) }) } });
  const srv = await listen(made.app);
  const ask = async (q) => {
    const resp = await fetch(`${srv.url}/api/data-management/columns?${Q}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-email': 'owner@example.com' },
      body: JSON.stringify(search({ catalogs: [], schemas: ['main.s'], tables: [] }, q)) });
    assert.equal(resp.status, 200);
    return (await resp.json()).hits.map((h) => h.column);
  };
  try {
    const starts = await ask('t1*');
    assert.ok(starts.length > 0 && starts.every((c) => c.startsWith('t1')), `every hit starts with t1: ${starts.slice(0, 3)}`);
    const ends = await ask('*_id');
    assert.ok(ends.length > 0 && ends.every((c) => c.endsWith('_id')), `every hit ends with _id: ${ends.slice(0, 3)}`);
    assert.ok(!ends.includes('id'), 'the bare id column has no underscore before id, so it is not a hit (must-exclude)');
    assert.deepEqual(await ask('*'), [], 'a bare star answers nothing');
  } finally {
    srv.close?.();
  }
});
