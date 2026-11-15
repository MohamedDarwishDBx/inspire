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
