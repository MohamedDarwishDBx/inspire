// REQ-180 gap, D-180A: a metric view is never offered as a table. Three routes name tables to the person: the App's table
// picker (the UC REST listing merged with a SHOW TABLES fallback), the swap suggestions for a picked table, and the free
// table lookup. SHOW TABLES returns no table type, so the fallback types each name with DESCRIBE TABLE EXTENDED ... AS JSON
// (its documented "type" field, METRIC_VIEW for a metric view). A table whose type cannot be read stays listed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeWorkspace, startInspire } = require('./support/serverProcess');

const SP_TOKEN = 'sp-token';
const PERSON = 'person-token';
const PERSON_EMAIL = ['pat.lee', 'example.com'].join('@');
const APP_ENV = { NODE_ENV: 'production', DATABRICKS_CLIENT_ID: 'inspire-client', DATABRICKS_CLIENT_SECRET: 'inspire-secret' };
const CAT = 'adb_fe_uae_01';
const SCH = 'default';
const TYPES = { orders: 'MANAGED', order_revenue_metrics: 'METRIC_VIEW', legacy: 'MANAGED', order_summary: 'VIEW' };
const SWAP_CANDIDATES = [['adb_fe_uae_01', 'default', 'order_revenue_metrics'], ['main', 's', 'orders'], ['main', 's', 'mystery_table']];
const signedIn = { 'x-forwarded-access-token': PERSON, 'x-forwarded-email': PERSON_EMAIL };

const done = (column, values) => [200, { status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: [{ name: column }] } },
  result: { data_array: values.map((v) => [v]) } }];
const table = (columns, rows) => [200, { status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: columns.map((name) => ({ name })) } },
  result: { data_array: rows } }];
const denied = (message) => [403, { error_code: 'PERMISSION_DENIED', message }];

function answer(call, { unreadable = [] } = {}) {
  const url = new URL(`http://x${call.path}`);
  if (call.path === '/oidc/v1/token') return [200, { access_token: SP_TOKEN, expires_in: 3600 }];
  if (call.path.startsWith('/api/2.0/preview/scim/v2/Me')) return [200, call.token === SP_TOKEN ? { userName: 'sp', applicationId: 'sp' } : { userName: PERSON_EMAIL }];
  if (call.token !== PERSON && call.token !== SP_TOKEN) return [401, { message: 'Invalid access token' }];
  if (url.pathname === '/api/2.1/unity-catalog/tables') return denied('User does not have USE SCHEMA');
  if (url.pathname !== '/api/2.0/sql/statements') return null;
  const stmt = String((call.body && call.body.statement) || '');
  const params = Object.fromEntries(((call.body && call.body.parameters) || []).map((p) => [p.name, p.value]));
  if (/system\.information_schema\.columns/.test(stmt)) {
    return table(['table_catalog', 'table_schema', 'table_name', 'matched', 'total', 'owned'],
      SWAP_CANDIDATES.map(([c, s, t]) => [c, s, t, '3', '3', '0']));
  }
  if (/information_schema\.tables WHERE table_schema = '/.test(stmt)) return denied('User does not have USE CATALOG');
  if (/^SELECT table_type FROM /.test(stmt)) {
    const type = TYPES[String(params.t || '').toLowerCase()];
    return table(['table_type'], type ? [[type]] : []);
  }
  if (/^SHOW TABLES IN /.test(stmt)) return done('tableName', Object.keys(TYPES));
  if (/^SELECT \* FROM /.test(stmt)) return table([], []);
  const described = /^DESCRIBE TABLE EXTENDED `([^`]+)`\.`([^`]+)`\.`([^`]+)` AS JSON$/.exec(stmt);
  if (described) {
    const name = described[3];
    if (unreadable.includes(name)) return denied(`User does not have SELECT on Table '${name}'.`);
    return done('json_metadata', [JSON.stringify({ table_name: name, type: TYPES[name] })]);
  }
  return null;
}

async function withWorkspace(opts, run) {
  const workspace = await fakeWorkspace((call) => answer(call, opts));
  let inspire = null;
  try {
    inspire = await startInspire({ DATABRICKS_HOST: workspace.url, NOTEBOOK_PATH: '/Shared/inspire/dbx_inspire_ai_agent', ...APP_ENV });
    return await run(inspire.url);
  } finally {
    if (inspire) await inspire.stop();
    await workspace.close();
  }
}

async function pickerTables(opts) {
  return withWorkspace(opts, async (url) => {
    const resp = await fetch(`${url}/api/tables/${CAT}/${SCH}?warehouse_id=wh`, { headers: signedIn });
    return (await resp.json()).tables;
  });
}

test('the table picker never lists a metric view when information_schema cannot be read', async () => {
  const tables = await pickerTables({});
  assert.deepEqual(tables.map((t) => t.name).sort(), ['legacy', 'order_summary', 'orders'],
    'a metric view is never a use case table or a Data Filters pick; SHOW TABLES alone cannot tell it apart');
});

test('a table typed by DESCRIBE keeps its real type, so a view is not shown as MANAGED', async () => {
  const byName = Object.fromEntries((await pickerTables({})).map((t) => [t.name, t.table_type]));
  assert.equal(byName.order_summary, 'VIEW');
  assert.equal(byName.orders, 'MANAGED');
});

test('a table whose type cannot be read is shown as not usable, with the plain reason, and is never offered as usable', async () => {
  const tables = await pickerTables({ unreadable: ['legacy'] });
  const legacy = tables.find((t) => t.name === 'legacy');
  assert.ok(legacy, 'the table is shown, so the person can see why it is not usable');
  assert.equal(legacy.usable, false);
  assert.match(legacy.unusable_reason, /Inspire could not read this table's type, so it cannot be used here/);
  assert.deepEqual(tables.filter((t) => t.usable !== false).map((t) => t.name).sort(), ['order_summary', 'orders']);
});

test('a metric view whose DESCRIBE is denied is never a usable table (must-exclude)', async () => {
  const tables = await pickerTables({ unreadable: ['order_revenue_metrics'] });
  assert.ok(tables.every((t) => !(t.name === 'order_revenue_metrics' && t.usable !== false)),
    'a denied-DESCRIBE metric view never becomes a usable table');
});

test('swap suggestions never offer a metric view, and never a table whose type cannot be read', async () => {
  await withWorkspace({}, async (url) => {
    const resp = await fetch(`${url}/api/inspire/implement/swaps?table=${encodeURIComponent('main.s.sales')}&warehouse_id=wh`,
      { method: 'POST', headers: { ...signedIn, 'Content-Type': 'application/json' }, body: '{}' });
    const got = await resp.json();
    assert.deepEqual(got.swaps.map((s) => s.table), ['main.s.orders']);
    assert.deepEqual(got.unusable.map((u) => u.table), ['main.s.mystery_table']);
    assert.match(got.unusable[0].reason, /Inspire could not read this table's type/);
  });
});

test('the free table lookup refuses a metric view with the Data Filters line, not a read error', async () => {
  await withWorkspace({}, async (url) => {
    const view = `${CAT}.${SCH}.order_revenue_metrics`;
    const resp = await fetch(`${url}/api/inspire/implement/table-lookup?table=${encodeURIComponent(view)}&source=main.s.sales&warehouse_id=wh`,
      { headers: signedIn });
    const got = await resp.json();
    assert.equal(got.readable, false);
    assert.match(got.reason, /is a metric view, so Inspire leaves it out of Data Filters/);
  });
});
