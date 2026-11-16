// REQ-389 follow-up (risk 1): the Results list shows the Data Filters of the scope a use case's latest built version read. A build that
// chose a scope on the Data step has it in its spec; a use case no build chose for keeps the Discover run's scope.
// REQ-389 follow-up (risk 2): a wizard preview reads the scope the Data step names (previewScopesOf), so it matches the build.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');
const { builtTableScopeOf } = require('../lib/inspireImplement');
const { previewScopesOf, parseTableScopeText } = require('../lib/inspireJobParams');

test.after(() => S.stopServer());

const SID = '42';
const UC = 'N01-U01';
const TABLE = 'main.s.orders';
const DISCOVER = JSON.stringify({ [TABLE]: { columns: ['paymentMethod'], rows: [{ column: 'paymentMethod', op: '=', values: ['visa'] }] } });
const USE_CASE = { session_id: SID, id: UC, use_case: 'Predict churn', primary_table: TABLE, tables_involved: '' };
const LIST = `/api/inspire/usecases?inspire_database=main.inspire&warehouse_id=wh1&session_id=${SID}`;
const version = (spec_version, spec_json, status = 'ready') => ({ session_id: SID, use_case_id: UC, spec_version, status, spec_json });
const GOLD = { [TABLE]: { columns: ['status'], rows: [{ column: 'status', op: '=', values: ['gold'] }] } };

async function filtersShown(history) {
  S.reset({ listedUseCases: [USE_CASE], sessionTableScopes: { [SID]: DISCOVER }, history });
  const got = await S.request('GET', LIST, { person: 'amr@example.com' });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  return got.data.usecases[0].data_filters.map((f) => f.column);
}

test('the Results list shows no Data Filters when the latest build read whole data, not the Discover filter (REQ-389, must-fail before)', async () => {
  assert.deepEqual(await filtersShown([version(2, { data: { table_scope: {} } })]), []);
});

test('the Results list shows the filter the latest build chose, in place of the Discover filter (REQ-389, must-fail before)', async () => {
  assert.deepEqual(await filtersShown([version(1, { data: { table_scope: GOLD } })]), ['status']);
});

test('a use case no build chose a scope for keeps the Discover run filter (must-keep)', async () => {
  assert.deepEqual(await filtersShown([version(1, { data: {} })]), ['paymentMethod']);
  assert.deepEqual(await filtersShown([]), ['paymentMethod'], 'a use case never built keeps the Discover filter');
});

test('the latest built version decides: an older choice is not shown, and a queued version does not count as built (REQ-389)', async () => {
  assert.deepEqual(await filtersShown([version(1, { data: { table_scope: GOLD } }), version(2, { data: {} })]), ['paymentMethod']);
  assert.deepEqual(await filtersShown([version(2, { data: { table_scope: {} } }), version(3, { data: { table_scope: GOLD } }, 'queued')]), []);
});

test('builtTableScopeOf reads the chosen scope of the latest built version and nothing else', () => {
  assert.deepEqual(builtTableScopeOf([version(2, { data: { table_scope: {} } }), version(1, { data: { table_scope: GOLD } })]), {});
  assert.equal(builtTableScopeOf([version(1, { data: {} })]), undefined);
  assert.equal(builtTableScopeOf([]), undefined);
});

test('previewScopesOf keeps the Discover scope with no choice, reads the chosen scope as text or object, and refuses malformed text', () => {
  const carried = parseTableScopeText(DISCOVER).scopes;
  assert.equal(previewScopesOf(undefined, carried), carried);
  assert.equal(previewScopesOf('', carried), carried);
  assert.deepEqual(previewScopesOf('{}', carried), {}, 'whole data is an empty scope');
  assert.deepEqual(previewScopesOf(JSON.stringify(GOLD), carried), GOLD);
  assert.deepEqual(previewScopesOf(GOLD, carried), GOLD);
  assert.throws(() => previewScopesOf('{not json', carried), (err) => err.statusCode === 400 && /not valid JSON/.test(err.message));
});
