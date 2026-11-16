// REQ-180 (fail closed): a table whose type cannot be read is shown as not usable, with its plain reason, and cannot be picked.
// The swap candidates that cannot be read reach the wizard as rows that cannot be chosen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { leftOutLine, unusableReasonOf, unusableSwapRows, UNUSABLE_TYPE_FALLBACK } from '../src/lib/tableUsability.js';
import { swapParts } from '../src/lib/implementWizard.js';
import { permanentPickProblem } from '../src/lib/pickProblem.js';

const REFUSAL = "main.s.mystery_table is not usable. Inspire could not read this table's type, so it cannot be used here. Pick another table you can read.";

test('only a table the backend marks usable:false is blocked, with its reason, and the plain fallback reason is used when none came', () => {
  assert.equal(unusableReasonOf({ name: 'orders', usable: false, unusable_reason: 'Plain reason.' }), 'Plain reason.');
  assert.equal(unusableReasonOf({ name: 'orders', usable: false }), UNUSABLE_TYPE_FALLBACK);
  assert.equal(unusableReasonOf({ name: 'orders', usable: true }), '', 'a usable table can be picked');
  assert.equal(unusableReasonOf({ name: 'orders' }), '', 'a row without the flag can be picked, as before');
  assert.equal(unusableReasonOf(null), '');
});

test('the left-out line names the schema and the count, once, for one table or many', () => {
  assert.equal(leftOutLine({ count: 0, schema: 'main.s' }), '');
  assert.equal(leftOutLine(null), '');
  assert.equal(leftOutLine({ count: 1, schema: 'main.s' }),
    '1 table in main.s was left out of this list: Inspire lists at most 1000 tables from one schema.');
  assert.equal(leftOutLine({ count: 5, schema: 'main.s' }),
    '5 tables in main.s were left out of this list: Inspire lists at most 1000 tables from one schema.');
});

test('a refusal for a table whose type cannot be read is a permanent pick problem with a neutral note (no Try again)', () => {
  assert.equal(permanentPickProblem(REFUSAL), 'unknown_type');
  assert.equal(permanentPickProblem('Databricks is busy right now, so wait a minute and try again'), '', 'a busy read stays retryable');
});

test('swap candidates that cannot be read are rows that cannot be chosen, with the plain reason', () => {
  assert.deepEqual(unusableSwapRows([{ table: 'main.s.mystery', reason: 'R' }]),
    [{ table: 'main.s.mystery', usable: false, unusable_reason: 'R', matched: 0, total: 0, copy: false }]);
});

test('swapParts hands the wizard the unusable candidates as unchoosable rows, after the usable ones (must-exclude)', async () => {
  const replies = {
    copy: { swaps: [] },
    '': { swaps: [{ table: 'main.s.orders', matched: 3, total: 3 }], unusable: [{ table: 'main.s.mystery', reason: 'R' }], why: '' },
  };
  const post = (part) => Promise.resolve(replies[part]);
  const seen = [];
  await swapParts(post, 'main.s.sales', (list, why) => seen.push({ list, why }));
  const similar = seen.find((x) => x.why === '');
  assert.deepEqual(similar.list.map((s) => s.table), ['main.s.orders', 'main.s.mystery']);
  const blocked = similar.list.find((s) => s.table === 'main.s.mystery');
  assert.equal(unusableReasonOf(blocked), 'R', 'the unknown-type candidate cannot be picked');
  assert.equal(unusableReasonOf(similar.list[0]), '', 'the usable candidate can be picked');
});
