// REQ-116: a stored money line that says "(currency not known)" is shown with the action, never the bare phrase, when its run
// recorded no currency. Estimates that carry a currency are shown exactly as stored. Fail-pre: the stale line keeps the phrase.
import test from 'node:test';
import assert from 'node:assert/strict';
import { valueEstimateOf } from '../src/lib/v130UseCase.js';

const STALE = '7K-18.7K a year (currency not known), if weekly tidbits revenue rises 3-8% (measured: 29,589; the percentages are an assumption)';

test('a stored money line with no recorded currency never says "currency not known" (must-exclude)', () => {
  const line = valueEstimateOf({ value_estimate_text: STALE, 'Value Estimate': JSON.stringify({ status: 'measured', currency: null, text: STALE }) });
  assert.doesNotMatch(line.text, /currency not known/);
  assert.equal(line.text, '7K-18.7K a year (no currency recorded on this run: run Discover again to convert it to the reporting currency), '
    + 'if weekly tidbits revenue rises 3-8% (measured: 29,589; the percentages are an assumption)');
  assert.equal(line.measured, true);
  assert.equal(line.currency, null);
});

test('a stored money line that carries its currency is shown exactly as stored', () => {
  const text = 'AED 7K-18.7K a year, if weekly tidbits revenue rises 3-8%';
  assert.deepEqual(valueEstimateOf({ value_estimate_text: text, 'Value Estimate': JSON.stringify({ status: 'measured', currency: 'AED', text }) }),
    { text, measured: true, currency: 'AED' });
});

test('a line without the phrase is untouched, even with no currency', () => {
  const text = 'Value not measured yet: measure the total of amount over a time window.';
  assert.deepEqual(valueEstimateOf({ value_estimate: JSON.stringify({ status: 'not measured yet', text }) }), { text, measured: false, currency: null });
});
