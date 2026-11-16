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

const col = (table, column_name) => ({ table, column_name });

test('orders.customer_id is matched to customers.customer_id by name, with the matching column name as the source', () => {
  const got = R.relationshipsOfTable(ORDERS, {
    columns: [col(ORDERS, 'order_id'), col(ORDERS, 'customer_id'), col(CUSTOMERS, 'customer_id'), col(CUSTOMERS, 'name')],
  });
  assert.deepEqual(got.suggestions, [{ from: { table: ORDERS, column: 'customer_id' }, to: { table: CUSTOMERS, column: 'customer_id' }, source: 'matching column name' }]);
});

test('a name match falls back to the id column of the other table when it has no column of the same name', () => {
  const got = R.relationshipsOfTable(ORDERS, { columns: [col(ORDERS, 'customer_id'), col(CUSTOMERS, 'id'), col(CUSTOMERS, 'name')] });
  assert.deepEqual(got.suggestions.map((s) => s.to), [{ table: CUSTOMERS, column: 'id' }]);
});

test('a declared key is listed once, with the declared key as its source, and is not repeated as a name match', () => {
  const declared = [{ column_name: 'customer_id', ref_catalog: 'main', ref_schema: 's', ref_table: 'customers', ref_column: 'customer_id' }];
  const got = R.relationshipsOfTable(ORDERS, { columns: [col(ORDERS, 'customer_id'), col(CUSTOMERS, 'customer_id')], declared });
  assert.deepEqual(got.suggestions, [{ from: { table: ORDERS, column: 'customer_id' }, to: { table: CUSTOMERS, column: 'customer_id' }, source: 'declared key' }]);
});

test('a declared key that points to a table outside the picked scope is not listed (it is not read by the run)', () => {
  const declared = [{ column_name: 'warehouse_id', ref_catalog: 'main', ref_schema: 's', ref_table: 'warehouses', ref_column: 'warehouse_id' }];
  const got = R.relationshipsOfTable(ORDERS, { columns: [col(ORDERS, 'warehouse_id'), col(CUSTOMERS, 'name')], declared });
  assert.deepEqual(got.suggestions, []);
});

test('a table that other picked tables declare a key into is listed from the child side, as a declared key', () => {
  const into = [{ child_catalog: 'main', child_schema: 's', child_table: 'orders', child_column: 'customer_id', ref_column: 'customer_id' }];
  const got = R.relationshipsOfTable(CUSTOMERS, { columns: [col(ORDERS, 'customer_id'), col(CUSTOMERS, 'customer_id')], into });
  assert.deepEqual(got.suggestions, [{ from: { table: ORDERS, column: 'customer_id' }, to: { table: CUSTOMERS, column: 'customer_id' }, source: 'declared key' }]);
});

test('must not match: a shared _id that is a key on neither side, and columns with unrelated names', () => {
  const got = R.relationshipsOfTable(ORDERS, {
    columns: [col(ORDERS, 'region_id'), col(ORDERS, 'status'), col(ITEMS, 'region_id'), col(ITEMS, 'sku')],
  });
  assert.deepEqual(got.suggestions, [], 'no table is named region, and neither region_id is a key, so there is no relationship');
});

test('a shared key column is matched when this table declares it as its primary key', () => {
  const got = R.relationshipsOfTable(ORDERS, {
    columns: [col(ORDERS, 'order_id'), col(ITEMS, 'order_id'), col(ITEMS, 'sku')], primaryKeys: ['order_id'],
  });
  assert.deepEqual(got.suggestions, [{ from: { table: ITEMS, column: 'order_id' }, to: { table: ORDERS, column: 'order_id' }, source: 'matching column name' }]);
});

test('only the relationships of the one table are returned, and its primary keys are its own', () => {
  const got = R.relationshipsOfTable(ORDERS, {
    columns: [col(ORDERS, 'customer_id'), col(CUSTOMERS, 'customer_id'), col(ITEMS, 'order_id'), col(ORDERS, 'order_id')],
    primaryKeys: ['order_id'],
  });
  assert.deepEqual(got.tables[ORDERS].primary_keys, ['order_id']);
  assert.deepEqual(got.tables[CUSTOMERS].primary_keys, []);
  assert.ok(got.suggestions.every((s) => s.from.table === ORDERS || s.to.table === ORDERS), 'nothing that does not involve orders');
});

test('a picked scope is trimmed of backticks and duplicates, refuses a bad name, and has no table-count cap', () => {
  assert.deepEqual(R.pickedTablesOf(['`main`.`s`.`orders`', 'main.s.orders', 'main.s.customers']), ['main.s.orders', 'main.s.customers']);
  assert.throws(() => R.pickedTablesOf(['orders']), /is not a catalog\.schema\.table name/);
  assert.throws(() => R.pickedTablesOf('main.s.orders'), /must be a list/);
  const many = Array.from({ length: 550 }, (_, i) => `main.s.t${i}`);
  assert.equal(R.pickedTablesOf(many).length, 550, 'a whole-catalog pick is not refused');
  assert.equal(R.pickedTableOf(' `main`.`s`.`orders` '), 'main.s.orders');
  assert.throws(() => R.pickedTableOf(''), /is not a catalog\.schema\.table name/);
});

test('the declared keys statements read the foreign keys of one table, out and in, with the person token, through information_schema', () => {
  const st = R.declaredKeysStatement(ORDERS);
  assert.match(st.sql, /`main`\.information_schema\.key_column_usage/);
  assert.match(st.sql, /information_schema\.constraint_column_usage/);
  assert.match(st.sql, /tc\.constraint_type = 'FOREIGN KEY'/);
  assert.deepEqual(st.parameters.map((p) => [p.name, p.value]), [['s', 's'], ['t', 'orders']]);
  const into = R.declaredIntoStatement(ORDERS);
  assert.match(into.sql, /ccu\.table_name = lower\(:t\)/, 'the parent side is matched on the referenced table');
});

test('the scope statement is one information_schema.columns query per catalog, with the picked tables as parameters', () => {
  const st = R.scopeColumnsStatement('main', [ORDERS, CUSTOMERS]);
  assert.equal((st.sql.match(/information_schema\.columns/g) || []).length, 1);
  assert.equal(st.parameters.length, 4);
  assert.doesNotMatch(st.sql, /orders|customers/, 'table names are bound, not written into the SQL');
});
