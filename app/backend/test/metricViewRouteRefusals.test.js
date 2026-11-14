// REQ-180, D-180A: the plan route refuses a metric view, and a table whose type cannot be read, by name, before any read of its
// rows. Plan reads the scope table's row count (the scope readiness count), a picked table swapped in (the owner table change)
// and the money rate table. Each refusal is a 400 with the plain line; a readable managed table still proceeds (pass-post guard).
const test = require('node:test');
const assert = require('node:assert/strict');
const MV = require('../lib/metricViews');
const I = require('../lib/inspireImplement');
const { makeApp, listen } = require('./support/implementApp');

const OWNER = ['owner', 'example.com'].join('@');
const PERSON_TOKEN = 'person-token';
const DB = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42' };
const USE_CASE = { id: 'N01-U01', use_case: 'Predict churn', primary_table: 'main.s.orders', tables_involved: 'main.s.orders', genie_instruction: '' };
const SPEC = { use_case_id: 'N01-U01', use_case_name: 'Predict churn', config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' }, outputs: { dashboard: true } };
const RATE_TABLE = { table: 'main.fx.rates', currency_column: 'ccy', base_column: 'base_ccy', date_column: 'rate_date', rate_column: 'rate', load_column: 'loaded_at' };
const UNREADABLE_TYPE = { 'table_type FROM': { rows: [] } };
// Only the named table's type is unreadable; every other table is a managed table, so the rate table is the one refused.
const unreadableOnly = (table) => ({ 'table_type FROM': (_sql, parameters) => {
  const named = (parameters || []).find((p) => p.name === 't');
  return { rows: named && named.value === table ? [] : [{ table_type: 'MANAGED' }] };
} });

async function withApp(overrides, run) {
  const made = makeApp({ useCase: USE_CASE, forwardedToken: PERSON_TOKEN, forwardedEmail: OWNER, ...overrides });
  const srv = await listen(made.app);
  try {
    await run(srv.url, made);
  } finally {
    await srv.close();
  }
}

async function plan(url, spec = SPEC) {
  const resp = await fetch(`${url}/api/inspire/implement/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...DB, spec }) });
  return { status: resp.status, data: await resp.json() };
}

// The statements that read a table's rows (its FROM clause), never the information_schema type or column lookups.
const rowReadsOf = (made, table) => made.sqlCalls.filter((c) => String(c.sql).includes(`FROM ${table}`));
const countsOf = (made) => made.sqlCalls.filter((c) => /^SELECT COUNT\(\*\) AS row_count/.test(String(c.sql)));
// A built version by the owner: a picked table swapped in is an owner table change, read with the person's own sign-in.
const BUILT = { session_id: '42', use_case_id: 'N01-U01', spec_version: 1, status: 'ready', created_by: OWNER, updated_at: '2026-10-21T04:00:00Z',
  spec_json: JSON.stringify(I.validateImplementSpec(I.withInspireUrl(SPEC, 'https://inspire.example.com')).spec), notebook_path: '/W/impl/N01-U01',
  job_id: '77', dashboard_id: 'd1', asset_status: JSON.stringify({ dashboard: { state: 'ready', spec_version: 1 } }) };
const columnReads = (made) => made.sqlCalls.filter((c) => /^SELECT column_name, data_type, ordinal_position FROM/.test(String(c.sql)));
const UNKNOWN_LINE = /main\.s\.orders is not usable\. Inspire could not read this table's type/;
const ORDERS = '`main`.`s`.`orders`';

test('plan refuses a metric view scope table by name, before it counts its rows (fail-pre: the count ran)', async () => {
  await withApp({ metricViews: ['main.s.orders'] }, async (url, made) => {
    const got = await plan(url);
    assert.equal(got.status, 400, JSON.stringify(got.data));
    assert.equal(got.data.error, MV.metricViewRefusal('main.s.orders'), 'the named plain line, not a warning that the count failed');
    assert.deepEqual(countsOf(made), [], 'no row count ran on the metric view');
    assert.deepEqual(rowReadsOf(made, ORDERS), [], 'no statement read the metric view’s rows');
  });
});

test('plan refuses a scope table whose type cannot be read, by name, before it counts its rows (fail-pre: the count ran)', async () => {
  await withApp({ statements: UNREADABLE_TYPE }, async (url, made) => {
    const got = await plan(url);
    assert.equal(got.status, 400, JSON.stringify(got.data));
    assert.match(got.data.error, UNKNOWN_LINE);
    assert.deepEqual(countsOf(made), [], 'no row count ran on a table whose type is unknown');
    assert.deepEqual(rowReadsOf(made, ORDERS), []);
  });
});

test('plan still counts and proceeds for a readable managed scope table (pass-post guard)', async () => {
  await withApp({ readinessRows: [{ row_count: '1200' }] }, async (url, made) => {
    const got = await plan(url);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data.warnings, []);
    const counts = countsOf(made);
    assert.equal(counts.length, 1, 'the scope table is counted once');
    assert.equal(counts[0].token, PERSON_TOKEN, 'counted with the person’s own token');
  });
});

test('plan refuses a metric view as the money rate table, by name, before any rate read (fail-pre: plan let it through)', async () => {
  const spec = { ...SPEC, money: { currency: 'convert', base: 'AED', rate_table: RATE_TABLE } };
  await withApp({ metricViews: ['main.fx.rates'] }, async (url, made) => {
    const got = await plan(url, spec);
    assert.equal(got.status, 400, JSON.stringify(got.data));
    assert.equal(got.data.error, MV.metricViewRefusal('main.fx.rates'));
    assert.deepEqual(rowReadsOf(made, '`main`.`fx`.`rates`'), [], 'the rate table rows are never read');
  });
});

test('plan refuses a money rate table whose type cannot be read, by name (fail-pre: plan let it through)', async () => {
  const spec = { ...SPEC, money: { currency: 'convert', base: 'AED', rate_table: RATE_TABLE } };
  await withApp({ statements: unreadableOnly('rates') }, async (url, made) => {
    const got = await plan(url, spec);
    assert.equal(got.status, 400, JSON.stringify(got.data));
    assert.match(got.data.error, /rates is not usable\. Inspire could not read this table's type/);
    assert.deepEqual(rowReadsOf(made, '`main`.`fx`.`rates`'), []);
  });
});

test('plan still proceeds with a readable managed rate table (pass-post guard)', async () => {
  const spec = { ...SPEC, money: { currency: 'convert', base: 'AED', rate_table: RATE_TABLE } };
  await withApp({}, async (url) => {
    const got = await plan(url, spec);
    assert.equal(got.status, 200, JSON.stringify(got.data));
  });
});

test('plan refuses a metric view swapped in for a picked table, by name, before any column of it is read (fail-pre: plan let it through)', async () => {
  await withApp({ history: [BUILT], metricViews: ['main.s.orders_v2'], me: { userName: OWNER, displayName: 'Owner' } }, async (url, made) => {
    const got = await plan(url, { ...SPEC, data: { tables: { 'main.s.orders': 'main.s.orders_v2' } } });
    assert.equal(got.status, 400, JSON.stringify(got.data));
    assert.equal(got.data.error, MV.metricViewRefusal('main.s.orders_v2'));
    assert.deepEqual(columnReads(made), [], 'no column of the metric view is read');
  });
});

test('plan refuses a picked table swapped in whose type cannot be read, by name, before any column of it is read (fail-pre)', async () => {
  await withApp({ history: [BUILT], statements: unreadableOnly('orders_v2'), me: { userName: OWNER, displayName: 'Owner' } }, async (url, made) => {
    const got = await plan(url, { ...SPEC, data: { tables: { 'main.s.orders': 'main.s.orders_v2' } } });
    assert.equal(got.status, 400, JSON.stringify(got.data));
    assert.match(got.data.error, /orders_v2 is not usable\. Inspire could not read this table's type/);
    assert.deepEqual(columnReads(made), []);
  });
});

test('plan still reads a readable managed table swapped in for a picked table (pass-post guard)', async () => {
  await withApp({ history: [BUILT], me: { userName: OWNER, displayName: 'Owner' } }, async (url, made) => {
    const got = await plan(url, { ...SPEC, data: { tables: { 'main.s.orders': 'main.s.orders_v2' } } });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.summary.table_change_error, undefined);
    assert.ok(columnReads(made).length >= 1, 'the swapped-in managed table is read as before');
  });
});
