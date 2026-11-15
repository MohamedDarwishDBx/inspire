import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { actionPhrase, goalLine, recordHeading, recordView, savingText, splitEstimate } from '../src/records.js';
import { plainUnit, unitOf, wholeMoney } from '../src/format.js';
import { amountText } from '../src/money.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (name) => readFileSync(join(SRC, name), 'utf8');

// REQ-302: the drawer title reads as the action for the record.
test('the drawer title is the use case action in the singular, then "for", then the record identifier', () => {
  assert.equal(actionPhrase('Review Risky Card Payments'), 'Review risky card payment');
  assert.equal(recordHeading(actionPhrase('Review Risky Card Payments'), 'card 71b5bbb38b, franchise 3000046'),
    'Review risky card payment for card 71b5bbb38b, franchise 3000046');
  assert.equal(actionPhrase('Forecast Weekly Orders for Stores'), 'Forecast weekly order for stores');
  assert.equal(actionPhrase('Price-loss decision desk'), 'Price-loss decision desk');
  assert.equal(actionPhrase('Stock Status'), 'Stock status', 'a word ending in us is not a plural');
  assert.equal(actionPhrase('Review Business Analytics'), 'Review business analytics', 'analytics stays whole');
  assert.equal(recordHeading('', 'card 71b5bbb38b'), 'card 71b5bbb38b', 'no use case name keeps the record name');
});

// REQ-302: the goal line states the use case goal in plain words.
test('the goal line says what the user is there to do, from the use case question', () => {
  assert.equal(goalLine('Which cards carry risky payments, and which to hold?'), 'Your job is to answer: Which cards carry risky payments, and which to hold?');
  assert.equal(goalLine('  '), '');
  assert.equal(goalLine(undefined), '');
});

// REQ-306: a money value is a clean number, and an estimate is a note.
test('an estimate tag never reaches the money value, and the saving shows a short plain note instead', () => {
  const tag = '[estimate: depends on inspire_01._inspire.bakehouse__sales_transactions]';
  const view = recordView({ key: 'k', label: 'l', columns: [] }, { value_at_stake: 180, currency: tag, impact_kind: '' },
    { value_at_stake_formula: `180 sale amount at risk = 180 ${tag}` }, {}, tag, '');
  assert.equal(view.saving.text, '180', 'the figure is a clean number');
  assert.doesNotMatch(view.saving.text, /estimate|inspire|_inspire|\[/);
  assert.equal(view.saving.formula, '180 sale amount at risk = 180');
  assert.equal(view.saving.note, 'Estimate, based on the data behind this record.');
  assert.doesNotMatch(JSON.stringify(view.saving), /inspire_01|bakehouse|\[estimate/i);
});

test('a unit keeps a plain word and drops anything that is an estimate, a bracket, a table path or a sentence', () => {
  assert.equal(plainUnit('USD'), 'USD');
  assert.equal(plainUnit('hours'), 'hours');
  assert.equal(plainUnit('[estimate: depends on quantity]'), '');
  assert.equal(plainUnit('(estimate: x)'), '');
  assert.equal(plainUnit('main.sales.orders'), '');
  assert.equal(plainUnit('a unit that is far too long to be a unit at all here'), '');
  assert.equal(unitOf({ unit: '[ESTIMATE: depends on quantity]', currency: 'USD' }), '');
  assert.equal(unitOf({ currency: 'EUR' }), 'EUR');
  assert.equal(wholeMoney(180, '[estimate: depends on orders]', 'number'), '180', 'a number kind never shows the tag as its unit');
  assert.equal(savingText(180, '[estimate: depends on orders]', 'number'), '180');
  assert.equal(savingText(8400, 'USD'), '$8,400', 'a real currency still shows');
  assert.equal(amountText(120, 'money', '[estimate: x]'), '120', 'the money text drops an estimate currency');
});

test('splitEstimate names the basis in plain words and keeps the figure text', () => {
  assert.deepEqual(splitEstimate('Margin at risk [ESTIMATE: depends on `order_quantity`]'), { text: 'Margin at risk', note: 'Estimate, based on order quantity.' });
  assert.deepEqual(splitEstimate('Plain text'), { text: 'Plain text', note: '' });
  assert.deepEqual(splitEstimate(''), { text: '', note: '' });
});

// REQ-302: Explain renders in place. The drawer hands the answer back and never opens the Genie panel.
test('Explain answers in the drawer and does not open another panel', () => {
  const records = read('Records.jsx');
  const app = read('App.jsx');
  const genie = read('Genie.jsx');
  assert.match(records, /\{ inPlace: true \}/, 'the drawer asks for an in-place explain');
  assert.match(records, /setExplained\(answer\?\.text \?/, 'the drawer shows the answer it was handed');
  assert.match(records, /<ExplainedAnswer explained=\{explained\} \/>/, 'the answer renders inside the Why section');
  assert.match(app, /if \(!request\.inPlace\) openGenie\(\);/, 'an in-place explain never opens the Genie panel');
  assert.match(genie, /return agentOn\(k\) \? sendAgent\(/, 'explain returns the answer');
  assert.match(genie, /return msg \|\| null;/, 'send hands the answer back');
});

test('the drawer heading and goal line are rendered', () => {
  const records = read('Records.jsx');
  assert.match(records, /<h2>\{heading\}<\/h2>/);
  assert.match(records, /data-goal/);
});
