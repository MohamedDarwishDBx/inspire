// REQ-362: the relationships between the tables a Launch picks. Declared keys come from information_schema, then name matches
// across the picked tables. Pure logic here; the route is checked through the mock app below.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../lib/relationships');
const { makeApp, listen } = require('./support/implementApp');

const ORDERS = 'main.s.orders';
const CUSTOMERS = 'main.s.customers';
const ITEMS = 'main.s.items';

test('a singular table name ends in the key the other table uses: customers -> customer, categories -> category, addresses -> address', () => {
  assert.equal(R.singularOf('customers'), 'customer');
  assert.equal(R.singularOf('categories'), 'category');
  assert.equal(R.singularOf('addresses'), 'address');
  assert.equal(R.singularOf('status'), 'status', 'a word that ends in -us keeps its s');
});

test('orders.customer_id is matched to customers.customer_id by name, with the matching column name as the source', () => {
  const got = R.relationshipsOf([ORDERS, CUSTOMERS], [
    [[{ column_name: 'order_id' }, { column_name: 'customer_id' }], [{ column_name: 'order_id' }], []],
    [[{ column_name: 'customer_id' }, { column_name: 'name' }], [{ column_name: 'customer_id' }], []],
  ]);
  assert.deepEqual(got.suggestions, [{ from: { table: ORDERS, column: 'customer_id' }, to: { table: CUSTOMERS, column: 'customer_id' }, source: 'matching column name' }]);
});

test('a name match falls back to the id column of the other table when it has no column of the same name', () => {
  const got = R.relationshipsOf([ORDERS, CUSTOMERS], [
    [[{ column_name: 'customer_id' }], [], []],
    [[{ column_name: 'id' }, { column_name: 'name' }], [{ column_name: 'id' }], []],
  ]);
  assert.deepEqual(got.suggestions.map((s) => s.to), [{ table: CUSTOMERS, column: 'id' }]);
});

test('a declared key is listed once, with the declared key as its source, and is not repeated as a name match', () => {
  const declared = [{ column_name: 'customer_id', ref_catalog: 'main', ref_schema: 's', ref_table: 'customers', ref_column: 'customer_id' }];
  const got = R.relationshipsOf([ORDERS, CUSTOMERS], [
    [[{ column_name: 'customer_id' }], [], declared],
    [[{ column_name: 'customer_id' }], [{ column_name: 'customer_id' }], []],
  ]);
  assert.deepEqual(got.suggestions, [{ from: { table: ORDERS, column: 'customer_id' }, to: { table: CUSTOMERS, column: 'customer_id' }, source: 'declared key' }]);
});

test('a declared key that points to a table the person did not pick is not listed (it is not read by the run)', () => {
  const declared = [{ column_name: 'warehouse_id', ref_catalog: 'main', ref_schema: 's', ref_table: 'warehouses', ref_column: 'warehouse_id' }];
  const got = R.relationshipsOf([ORDERS, CUSTOMERS], [[[{ column_name: 'warehouse_id' }], [], declared], [[{ column_name: 'name' }], [], []]]);
  assert.deepEqual(got.suggestions, []);
});

test('must not match: a shared _id that is a key on neither side, and columns with unrelated names', () => {
  const got = R.relationshipsOf([ORDERS, ITEMS], [
    [[{ column_name: 'region_id' }, { column_name: 'status' }], [], []],
    [[{ column_name: 'region_id' }, { column_name: 'sku' }], [], []],
  ]);
  assert.deepEqual(got.suggestions, [], 'no table is named region, and neither region_id is a key, so there is no relationship');
});

test('a shared key column is matched when the other table declares it as its primary key', () => {
  const got = R.relationshipsOf([ITEMS, ORDERS], [
    [[{ column_name: 'order_id' }, { column_name: 'sku' }], [], []],
    [[{ column_name: 'order_id' }], [{ column_name: 'order_id' }], []],
  ]);
  assert.deepEqual(got.suggestions, [{ from: { table: ITEMS, column: 'order_id' }, to: { table: ORDERS, column: 'order_id' }, source: 'matching column name' }]);
});

test('a picked table list is trimmed of backticks and duplicates, and refuses a bad name or more than 40 tables', () => {
  assert.deepEqual(R.pickedTablesOf(['`main`.`s`.`orders`', 'main.s.orders', 'main.s.customers']), ['main.s.orders', 'main.s.customers']);
  assert.throws(() => R.pickedTablesOf(['orders']), /is not a catalog\.schema\.table name/);
  assert.throws(() => R.pickedTablesOf('main.s.orders'), /must be a list/);
  const many = Array.from({ length: 41 }, (_, i) => `main.s.t${i}`);
  assert.throws(() => R.pickedTablesOf(many), /at most 40 tables/);
});

test('the declared keys statement reads the foreign keys of one table with the person token, through information_schema', () => {
  const st = R.declaredKeysStatement(ORDERS);
  assert.match(st.sql, /`main`\.information_schema\.key_column_usage/);
  assert.match(st.sql, /information_schema\.constraint_column_usage/);
  assert.match(st.sql, /tc\.constraint_type = 'FOREIGN KEY'/);
  assert.deepEqual(st.parameters.map((p) => [p.name, p.value]), [['s', 's'], ['t', 'orders']]);
});

test('POST /api/relationships reads each picked table and returns its columns and the suggested relationships', async () => {
  const made = makeApp({
    columnsByTable: {
      [ORDERS]: [{ column_name: 'order_id' }, { column_name: 'customer_id' }],
      [CUSTOMERS]: [{ column_name: 'customer_id' }, { column_name: 'name' }],
    },
    // Only customers declares a key, so the orders side is not a key (the mock's primaryKeys would apply to both tables).
    statements: {
      'AS ref_table': { rows: [] },
      "'PRIMARY KEY'": (_sql, parameters) => ({ rows: parameters.find((p) => p.name === 't').value === 'customers' ? [{ column_name: 'customer_id' }] : [] }),
    },
  });
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}/api/relationships?warehouse_id=wh1`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-email': 'owner@example.com' },
      body: JSON.stringify({ tables: [ORDERS, CUSTOMERS] }),
    });
    const body = await resp.json();
    assert.equal(resp.status, 200, JSON.stringify(body));
    assert.deepEqual(body.tables[ORDERS].columns, ['order_id', 'customer_id']);
    assert.deepEqual(body.suggestions, [{ from: { table: ORDERS, column: 'customer_id' }, to: { table: CUSTOMERS, column: 'customer_id' }, source: 'matching column name' }]);
  } finally {
    await srv.close();
  }
});

test('POST /api/relationships with one picked table and no columns refuses the read by name', async () => {
  const made = makeApp({ columnsByTable: {} });
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}/api/relationships?warehouse_id=wh1`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-email': 'owner@example.com' },
      body: JSON.stringify({ tables: [ORDERS] }),
    });
    assert.equal(resp.status, 404, 'a table whose columns cannot be read is named and not guessed at');
  } finally {
    await srv.close();
  }
});
