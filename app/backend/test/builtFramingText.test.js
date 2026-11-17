// REQ-389 part 2 (lane R49, ruling): the use case text the App shows is the text the latest build carried. The build writes its goal and
// success measures, with the Discover run's scope text taken out, into its own record (built_framing). The Discover statement stays as
// Discover wrote it, and a use case no build has framed for keeps its statement. These tests fail on the base and pass after the change.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');
const { builtFramingOf, builtTextOf } = require('../lib/inspireImplement');

test.after(() => S.stopServer());

const SID = '42';
const UC = 'N01-U01';
const TABLE = 'main.s.orders';
const DISCOVER_STATEMENT = 'Find repeat buyers. This covers only the rows of `main.s.orders` where `paymentMethod` is visa or amex.';
const DISCOVER = JSON.stringify({ [TABLE]: { columns: ['paymentMethod'], rows: [{ column: 'paymentMethod', op: '=', values: ['visa'] }] } });
const USE_CASE = { session_id: SID, id: UC, use_case: 'Predict churn', statement: DISCOVER_STATEMENT, primary_table: TABLE, tables_involved: '' };
const LIST = `/api/inspire/usecases?inspire_database=main.inspire&warehouse_id=wh1&session_id=${SID}`;
const BUILT = { goal: 'Find repeat buyers. Covers only the columns `id` of main.s.orders.', success_measures: ['A list of repeat buyers is delivered.'] };
const version = (spec_version, built_framing, status = 'ready') => ({ session_id: SID, use_case_id: UC, spec_version, status, spec_json: { data: {} }, built_framing });

async function listedRow(history) {
  S.reset({ listedUseCases: [USE_CASE], sessionTableScopes: { [SID]: DISCOVER }, history, implementReadError: '' });
  const got = await S.request('GET', LIST, { person: 'amr@example.com' });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  return got.data.usecases[0];
}

test('the App use case text is the text the latest built version carried, not the Discover statement (REQ-389 R49, must-fail before)', async () => {
  const row = await listedRow([version(2, BUILT)]);
  assert.equal(row.Statement, BUILT.goal, row.Statement);
  assert.deepEqual(row.built_success_measures, BUILT.success_measures);
  assert.ok(!/visa or amex/.test(row.Statement), row.Statement);
});

test('a use case no build has framed for keeps its Discover statement (must-keep)', async () => {
  const row = await listedRow([version(1, null)]);
  assert.equal(row.Statement, DISCOVER_STATEMENT);
  assert.equal(row.built_success_measures, undefined);
  assert.equal((await listedRow([])).Statement, DISCOVER_STATEMENT, 'a use case never built keeps its statement');
});

test('builtFramingOf reads the latest done build and ignores a queued one (REQ-389 R49)', () => {
  assert.deepEqual(builtFramingOf([version(2, BUILT), version(1, { goal: 'old', success_measures: [] })]), BUILT);
  assert.equal(builtFramingOf([version(3, BUILT, 'queued'), version(1, null)]), undefined);
  assert.equal(builtFramingOf([version(1, { goal: '', success_measures: [] })]), undefined, 'an empty goal is no framing');
  assert.equal(builtFramingOf([]), undefined);
});

test('builtTextOf gives the App the built text, and nothing when no build framed the use case (REQ-389 R49)', () => {
  assert.deepEqual(builtTextOf(BUILT), { Statement: BUILT.goal, built_success_measures: BUILT.success_measures });
  assert.deepEqual(builtTextOf(undefined), {});
});
