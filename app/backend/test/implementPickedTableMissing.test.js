// REQ-180: a picked table in a catalog that does not exist fails its per-catalog information_schema read with the view's
// name ("`amr_ali`.`information_schema`.`columns` cannot be found"). The error must name the table the person picked, so the
// message is the table, and Try again is not offered for it. Other errors pass through unchanged.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const I = require('../lib/inspireImplement');
const { makeApp, listen } = require('./support/implementApp');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);
const PICKED = 'amr_ali.sales.orders';
const MISSING_CATALOG = '[TABLE_OR_VIEW_NOT_FOUND] The table or view `amr_ali`.`information_schema`.`columns` cannot be found. '
  + 'Verify the spelling and correctness of the schema and catalog. SQLSTATE: 42P01; line 1 pos 24';
const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42&use_case_id=N01-U01';
const USE_CASE = { id: 'N01-U01', use_case: 'Predict churn', primary_table: PICKED, tables_involved: PICKED, genie_instruction: '' };
const BUILT = { session_id: '42', use_case_id: 'N01-U01', spec_version: 1, status: 'ready', created_by: 'owner@example.com', updated_at: '2026-10-21T04:00:00Z',
  spec_json: JSON.stringify({ use_case_id: 'N01-U01', config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' }, outputs: {} }),
  asset_status: JSON.stringify({}) };

test('a missing catalog error names the picked table, not the information_schema view (REQ-180)', () => {
  assert.equal(typeof I.pickedTableError, 'function', 'the helper exists and is exported');
  const named = I.pickedTableError(new Error(MISSING_CATALOG), PICKED);
  assert.match(named.message, /`amr_ali`\.`sales`\.`orders` cannot be found/);
  assert.doesNotMatch(named.message, /information_schema/);
  assert.equal(named.statusCode, 400);
});

test('an error that is not a missing object passes through the helper unchanged (the same error object)', () => {
  const denied = Object.assign(new Error("[PERMISSION_DENIED] User does not have SELECT on Table 'amr_ali.sales.orders'."), { statusCode: 403 });
  assert.equal(I.pickedTableError(denied, PICKED), denied);
  const ownTable = new Error('[TABLE_OR_VIEW_NOT_FOUND] The table or view `amr_ali`.`sales`.`orders` cannot be found.');
  assert.equal(I.pickedTableError(ownTable, PICKED), ownTable, 'a missing picked table is already named by the error');
});

test('readPickedTable rewrites the error of its read and returns the read result when it succeeds', async () => {
  assert.equal(await I.readPickedTable(PICKED, async () => 'rows'), 'rows');
  await assert.rejects(I.readPickedTable(PICKED, async () => { throw new Error(MISSING_CATALOG); }),
    (err) => /amr_ali\.sales\.orders|`amr_ali`\.`sales`\.`orders`/.test(err.message) && !/information_schema/.test(err.message));
});

test('the Build page reads that name the table show the picked table as missing, in plain words (REQ-180)', async () => {
  const { splitTechnical } = await lib('plainText.js');
  const named = I.pickedTableError(new Error(MISSING_CATALOG), PICKED);
  const plain = splitTechnical(named.message).plain;
  assert.equal(plain, 'Table amr_ali.sales.orders does not exist, so check that it was not renamed or dropped, or pick another one.');
});

test('the columns route answers with the picked table named when its catalog is missing (REQ-180)', async () => {
  const made = makeApp({ useCase: USE_CASE, history: [BUILT], sqlErrors: { 'information_schema.columns': MISSING_CATALOG } });
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}/api/inspire/implement/columns?${Q}&table=${PICKED}`, {
      headers: { 'Content-Type': 'application/json', 'x-forwarded-email': 'owner@example.com' } });
    const data = await resp.json();
    assert.equal(resp.status, 400, JSON.stringify(data));
    assert.match(data.error, /amr_ali\.sales\.orders|`amr_ali`\.`sales`\.`orders`/, 'the picked table is named');
    assert.doesNotMatch(data.error, /information_schema/, 'the view is not named');
  } finally {
    srv.close?.();
  }
});
