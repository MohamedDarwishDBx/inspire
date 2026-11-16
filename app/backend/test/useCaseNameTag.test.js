const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { useCaseNameTag, inspireJobTags, USE_CASE_NAME_TAG, inspireTagValueMax } = require('../lib/inspireJobParams');

const FIXTURE = path.join(__dirname, '..', '..', 'agent', 'tests', 'fixtures', 'usecase_name_cases.json');
const { cases } = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

test('the use case name encoder matches the shared parity fixture (Python mirror reads the same file)', () => {
  for (const c of cases) {
    assert.equal(useCaseNameTag(c.name, c.max), c.expected, JSON.stringify(c));
  }
});

test('"Predict Customer Churn" encodes to predict_customer_churn and punctuation is folded to single underscores', () => {
  assert.equal(useCaseNameTag('Predict Customer Churn'), 'predict_customer_churn');
  assert.equal(useCaseNameTag('  Predict   Customer  Churn!! '), 'predict_customer_churn');
});

test('non-Latin letters are folded to word separators, and a name with no ASCII letters encodes to nothing', () => {
  assert.equal(useCaseNameTag('Café Résumé Scoring'), 'cafe_resume_scoring');
  assert.equal(useCaseNameTag('客户流失'), '');
  assert.equal(useCaseNameTag(undefined), '');
});

test('a long name is truncated on a word boundary within the tag value limit, never mid-word when a boundary exists', () => {
  const long = 'Predict the probability that each active subscriber cancels within the next ninety days';
  const tag = useCaseNameTag(long, 40);
  assert.ok(tag.length <= 40);
  assert.equal(tag, 'predict_the_probability_that_each_active');
  assert.equal(useCaseNameTag(long), useCaseNameTag(long, inspireTagValueMax()), 'the default max is the cloud value limit');
  assert.ok(useCaseNameTag(long).length <= inspireTagValueMax());
});

test('a use case run carries the name tag, and a Discover or multi-use-case run carries none (must-exclude)', () => {
  const one = inspireJobTags({ runType: 'implement', params: {}, useCaseIds: ['N01-U01'], useCaseName: 'Predict Customer Churn' });
  assert.equal(one[USE_CASE_NAME_TAG], 'predict_customer_churn');
  assert.equal(one.dbx_inspire_ai_usecase_id, 'N01-U01', 'the id tag keeps its value');

  const discovery = inspireJobTags({ runType: 'discovery', params: {}, businessName: 'Acme', useCaseName: 'Predict Customer Churn' });
  assert.equal(USE_CASE_NAME_TAG in discovery, false, 'a Discover run has no single use case, so no name tag');

  const many = inspireJobTags({ runType: 'genie_regen', params: {}, useCaseIds: ['N01-U01', 'N01-U02'], useCaseName: 'Predict Customer Churn' });
  assert.equal(USE_CASE_NAME_TAG in many, false, 'two use cases share no single name');

  const unnamed = inspireJobTags({ runType: 'implement', params: {}, useCaseIds: ['N01-U01'] });
  assert.equal(USE_CASE_NAME_TAG in unnamed, false, 'a launch that does not know the name does not invent one');
});

test('the implement tracking row carries the encoded use case name and the warehouse the App queries, or null when unknown', () => {
  const I = require('../lib/inspireImplement');
  const base = { sessionId: 42, useCaseId: 'N01-U01', specVersion: 2, spec: {}, createdBy: 'a@b.c', statusMessage: 'queued', changeClasses: [] };
  const named = I.implementInsertStatement('`c`.`s`.`__inspire_implement`', { ...base, useCaseName: 'Predict Customer Churn', warehouseId: 'wh1' });
  assert.match(named.sql, /use_case_name_tag, warehouse_id\) VALUES/);
  const byName = Object.fromEntries(named.parameters.map((p) => [p.name, p]));
  assert.equal(byName.nametag.value, 'predict_customer_churn');
  assert.equal(byName.warehouse.value, 'wh1');
  const unknown = I.implementInsertStatement('`c`.`s`.`__inspire_implement`', { ...base });
  const unknownByName = Object.fromEntries(unknown.parameters.map((p) => [p.name, p]));
  assert.equal(unknownByName.nametag.value, undefined, 'no name is invented when the launch does not know it');
  assert.equal(unknownByName.warehouse.value, undefined);
  const columns = I.IMPLEMENT_COLUMNS.map(([n]) => n);
  assert.ok(columns.includes('use_case_name_tag') && columns.includes('warehouse_id'), 'both columns are migrated onto existing tables');
});

test('the implement tracking columns match the notebook copy, so the App and the agent migrate and write the same table', () => {
  const I = require('../lib/inspireImplement');
  const nb = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'agent', 'agent', 'dbx_inspire_ai_agent.ipynb'), 'utf8'));
  const source = nb.cells.map((c) => (Array.isArray(c.source) ? c.source.join('') : String(c.source))).find((s) => s.includes('IMPLEMENT_COLUMNS = ('));
  const block = source.slice(source.indexOf('IMPLEMENT_COLUMNS = ('), source.indexOf('IMPLEMENT_TABLE_COMMENT'));
  const notebook = [...block.matchAll(/\("([a-z_]+)", "([A-Z]+)"\)/g)].map((m) => `${m[1]}:${m[2]}`).sort();
  const js = I.IMPLEMENT_COLUMNS.map(([name, kind]) => `${name}:${kind}`).sort();
  assert.deepEqual(js, notebook);
  assert.ok(js.includes('lakebase_project_id:STRING') && js.includes('use_case_name_tag:STRING') && js.includes('warehouse_id:STRING'));
});
