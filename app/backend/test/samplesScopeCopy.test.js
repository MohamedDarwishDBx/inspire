const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);

// REQ-242: a Data Filter set on a samples table must reach the run when the person copies that table first. The copy path re-keys
// the scope to the copy, and both paths build the 17_table_scope text through one launch function.
const SOURCE = 'samples.bakehouse.sales_franchises';
const COPY = 'inspire_kinds_rc7._inspire.sales_franchises';
const OTHER_SOURCE = 'samples.bakehouse.sales_customers';
const OTHER_COPY = 'inspire_kinds_rc7._inspire.sales_customers';
const SCOPE = {
  columns: ['franchiseID', 'country'],
  rows: [{ column: 'country', op: 'in', values: ['Japan', 'US'], group: true }],
};
const SCOPES = { [SOURCE]: SCOPE };
const DESTINATION = 'inspire_kinds_rc7._inspire';

test('a scope on a samples table follows the table into its copy', async () => {
  const S = await lib('samplesCopy.js');
  const moved = S.scopesAfterSampleCopies(SCOPES, [{ source: SOURCE, copy: COPY }]);
  assert.deepEqual(Object.keys(moved), [COPY]);
  assert.deepEqual(moved[COPY], SCOPE);
  assert.deepEqual(S.scopesAfterSampleCopies(SCOPES, []), SCOPES);
});

test('a failed copy keeps its scope under the samples name, and a reused copy takes the scope', async () => {
  const S = await lib('samplesCopy.js');
  const failed = S.scopesAfterSampleCopies(SCOPES, [{ source: OTHER_SOURCE, copy: OTHER_COPY }]);
  assert.deepEqual(Object.keys(failed), [SOURCE]);
  const reused = S.scopesAfterSampleCopies(SCOPES, [{ source: SOURCE, copy: COPY, reused: true }]);
  assert.deepEqual(Object.keys(reused), [COPY]);
});

test('the scope is matched to its source in any case, as the scope keys are', async () => {
  const S = await lib('samplesCopy.js');
  const moved = S.scopesAfterSampleCopies({ 'SAMPLES.Bakehouse.Sales_Franchises': SCOPE }, [{ source: SOURCE, copy: COPY }]);
  assert.deepEqual(Object.keys(moved), [COPY]);
});

test('the copy path and the direct path send the same 17_table_scope for the same copied tables', async () => {
  const S = await lib('samplesCopy.js');
  const T = await lib('tableScope.js');
  // Copy path: the scope was set on the samples table, then the table was copied and the picks moved to the copy.
  const picks = S.applySampleCopies({ catalogs: ['samples'], schemas: ['samples.bakehouse'], tables: [SOURCE] },
    { destination: DESTINATION, copies: [{ source: SOURCE, copy: COPY }], failed: [] });
  const copyPath = T.launchTableScopeText(S.scopesAfterSampleCopies(SCOPES, [{ source: SOURCE, copy: COPY }]), picks, 'Japan and US');
  // Direct path: the person set the same scope on the copied table and picked it.
  const direct = T.launchTableScopeText({ [COPY]: SCOPE }, { catalogs: [], schemas: [], tables: [COPY] }, 'Japan and US');
  assert.ok(copyPath, 'the copy path sends a scope');
  assert.equal(copyPath, direct);
  const sent = JSON.parse(copyPath);
  assert.deepEqual(Object.keys(sent), [COPY, 'use_case_label']);
  assert.equal(sent.use_case_label, 'Japan and US');
});

test('without the re-key the copy path sends nothing, which is the regression this fixes', async () => {
  const T = await lib('tableScope.js');
  const picks = { catalogs: [], schemas: [DESTINATION], tables: [COPY, OTHER_COPY] };
  // Scope still keyed by the samples name: no scope is sent (the defect).
  assert.equal(T.launchTableScopeText(SCOPES, picks, 'Japan and US'), '');
});

test('a scope on a table the picks do not read is not sent', async () => {
  const T = await lib('tableScope.js');
  const text = T.launchTableScopeText({ [COPY]: SCOPE, [OTHER_COPY]: SCOPE }, { catalogs: [], schemas: [], tables: [COPY] }, '');
  assert.deepEqual(Object.keys(JSON.parse(text)), [COPY]);
});

// The server side of the same path: the copy sits under the destination schema the launch picks, so its scope is kept.
test('the backend keeps the scope of a copied table when the copy destination schema is the picked location', () => {
  const jobParams = require('../lib/inspireJobParams');
  const params = { '01_uc_metadata': DESTINATION, '17_table_scope': JSON.stringify({ [COPY]: SCOPE, use_case_label: 'Japan and US' }) };
  const kept = jobParams.validateTableScopeParams(params);
  assert.deepEqual(Object.keys(JSON.parse(kept['17_table_scope'])), [COPY, 'use_case_label']);
});

// Two samples tables with one table name in different schemas: their copies must not share a name, and each scope stays on its own copy.
// A copy name is schema__table. Pairs that differ only by where the underscores fall stay distinct, and a pair that lands on one name is refused.
test('a readable copy name, distinct underscore pairs, and a refusal for the pair that lands on one name', () => {
  const impl = require('../lib/inspireImplement');
  assert.equal(impl.sampleCopyTable('samples.bakehouse.sales_franchises'), 'bakehouse__sales_franchises');
  const dest = { catalog: 'inspire_kinds_rc7', schema: '_inspire' };
  assert.equal(impl.sampleCopyClash(['samples.a_b.c', 'samples.a.b_c'], dest), '', 'a_b + c and a + b_c stay distinct');
  assert.notEqual(impl.sampleCopyTable('samples.a_b.c'), impl.sampleCopyTable('samples.a.b_c'));
  const clash = impl.sampleCopyClash(['samples.a__b.c', 'samples.a.b__c'], dest);
  assert.equal(clash, 'samples.a__b.c and samples.a.b__c would both copy to inspire_kinds_rc7._inspire.a__b__c. Copy one of them on its own.');
  assert.equal(impl.sampleCopyClash(['samples.a.b__c', 'samples.a.b__c'], dest), '', 'the same table twice is not a clash');
});

test('the statement and the returned copy name come from one helper, so they name the same table', () => {
  const impl = require('../lib/inspireImplement');
  const dest = { catalog: 'inspire_kinds_rc7', schema: '_inspire' };
  const src = 'samples.a_b.c_d';
  const table = impl.sampleCopyTable(src);
  assert.equal(impl.sampleCopyName(src, dest), `inspire_kinds_rc7._inspire.${table}`);
  assert.match(impl.sampleCopyStatement(src, dest), new RegExp(`\\\`${table}\\\` AS SELECT`));
});

test('two samples tables with one table name in different schemas copy to different tables, and their scopes stay separate', async () => {
  const impl = require('../lib/inspireImplement');
  const S = await lib('samplesCopy.js');
  const dest = { catalog: 'inspire_kinds_rc7', schema: '_inspire' };
  const A = 'samples.bakehouse.sales_franchises';
  const B = 'samples.tpch.sales_franchises';
  const copyA = impl.sampleCopyName(A, dest);
  const copyB = impl.sampleCopyName(B, dest);
  assert.notEqual(copyA, copyB, 'the copies do not collide');
  assert.equal(copyA, 'inspire_kinds_rc7._inspire.bakehouse__sales_franchises');
  assert.match(impl.sampleCopyStatement(A, dest), new RegExp(`\`bakehouse__sales_franchises\` AS SELECT`));
  assert.match(impl.sampleCopyStatement(B, dest), new RegExp(`\`tpch__sales_franchises\` AS SELECT`));
  const scopeB = { columns: ['franchiseID'], rows: [{ column: 'franchiseID', op: '>=', values: ['3000001'] }] };
  const moved = S.scopesAfterSampleCopies({ [A]: SCOPE, [B]: scopeB }, [{ source: A, copy: copyA }, { source: B, copy: copyB }]);
  assert.deepEqual(moved[copyA], SCOPE);
  assert.deepEqual(moved[copyB], scopeB);
  assert.equal(Object.keys(moved).length, 2);
});
