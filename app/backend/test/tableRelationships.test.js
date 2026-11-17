// REQ-373: the joins the person draws on the Launch page reach the run as 18_table_relationships. Malformed joins are refused,
// joins on tables the picks do not read are dropped (as scopes are), and a launch with no join sends no widget value.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);
const jobParams = require('../lib/inspireJobParams');

const ORDERS = 'main.sales.orders';
const CUSTOMERS = 'main.sales.customers';
const PRODUCTS = 'main.catalog.products';
const JOIN = { from: { table: ORDERS, column: 'customer_id' }, to: { table: CUSTOMERS, column: 'customer_id' } };

test('the relationships the run reads are one JSON list; a malformed list is refused with the reason', async () => {
  const R = await lib('tableRelationships.js');
  assert.deepEqual(R.relationshipsFromObject([JOIN]), { relations: [JOIN], problems: [] });
  assert.deepEqual(R.relationshipsFromObject(undefined), { relations: [], problems: [] });
  assert.match(R.relationshipsFromObject({ from: JOIN.from }).problems[0], /must be a list/);
  assert.match(R.relationshipsFromObject([{ from: { table: 'orders', column: 'id' }, to: JOIN.to }]).problems[0],
    /catalog\.schema\.table name and a column on each side/);
  assert.match(R.relationshipsFromObject([{ from: JOIN.from, to: { table: CUSTOMERS, column: '' } }]).problems[0], /column on each side/);
});

test('a join listed twice, or written with backticks, is read once', async () => {
  const R = await lib('tableRelationships.js');
  const ticked = { from: { table: '`main`.`sales`.`orders`', column: 'customer_id' }, to: JOIN.to };
  assert.equal(R.relationshipsFromObject([JOIN, JOIN, ticked]).relations.length, 1);
});

test('the launch sends only the joins whose both tables the run reads', async () => {
  const R = await lib('tableRelationships.js');
  const onPicked = { from: { table: CUSTOMERS, column: 'region_id' }, to: { table: ORDERS, column: 'region_id' } };
  const offPicked = { from: { table: ORDERS, column: 'product_id' }, to: { table: PRODUCTS, column: 'product_id' } };
  const text = R.launchRelationshipsText([JOIN, onPicked, offPicked], [ORDERS, CUSTOMERS]);
  assert.deepEqual(JSON.parse(text), [JOIN, onPicked]);
  assert.equal(R.launchRelationshipsText([offPicked], [ORDERS, CUSTOMERS]), '', 'no applicable join sends no widget value');
  assert.equal(R.launchRelationshipsText([], [ORDERS]), '');
});

test('the job params carry the joins the picks read, and refuse a malformed list', () => {
  const kept = jobParams.sanitizeInspireNotebookJobParams({
    '01_uc_metadata': 'main.sales',
    '18_table_relationships': JSON.stringify([JOIN, { from: { table: PRODUCTS, column: 'id' }, to: { table: PRODUCTS, column: 'id' } }]),
  });
  assert.deepEqual(JSON.parse(kept['18_table_relationships']), [JOIN], 'a join on a table the picks do not read is dropped');
  assert.ok(jobParams.INSPIRE_NOTEBOOK_WIDGET_KEYS.includes('18_table_relationships'));
  assert.throws(() => jobParams.validateRelationshipParams({ '01_uc_metadata': 'main.sales', '18_table_relationships': '{nope' }),
    /not valid JSON/);
  assert.throws(() => jobParams.validateRelationshipParams({ '01_uc_metadata': 'main.sales', '18_table_relationships': '[{"from":1}]' }),
    /Table relationships/);
});

test('a launch with no join sends no 18_table_relationships key, as before REQ-373', () => {
  const none = jobParams.sanitizeInspireNotebookJobParams({ '01_uc_metadata': 'main.sales', '18_table_relationships': '' });
  assert.equal('18_table_relationships' in none, false);
  const plain = jobParams.sanitizeInspireNotebookJobParams({ '01_uc_metadata': 'main.sales' });
  assert.equal('18_table_relationships' in plain, false);
});
