// REQ-180: a metric view and a picked table that is gone are permanent states, so the wizard shows them without Try again.
// A busy or denied read stays retryable or fixable by a grant, and is not permanent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { METRIC_VIEW_REFUSAL, permanentPickProblem } from '../src/lib/pickProblem.js';

const METRIC_REFUSAL = 'adb_fe_uae_01.default.order_revenue_metrics is a metric view, so Inspire leaves it out of Data Filters; pick its source table instead';
const GONE = '[TABLE_OR_VIEW_NOT_FOUND] The table or view `amr_ali`.`sales`.`orders` cannot be found. Verify the spelling. SQLSTATE: 42P01';

test('a metric view refusal is a permanent pick problem, and the refusal pattern matches it', () => {
  assert.ok(METRIC_VIEW_REFUSAL.test(METRIC_REFUSAL));
  assert.equal(permanentPickProblem(METRIC_REFUSAL), 'metric_view');
});

test('a picked table that is gone is a permanent pick problem, whatever object the raw error names', () => {
  assert.equal(permanentPickProblem(GONE), 'missing');
  assert.equal(permanentPickProblem('Table amr_ali.sales.orders does not exist, so check that it was not renamed or dropped, or pick another one.'), '');
});

test('busy, denied and empty reads are not permanent: they stay retryable or fixable by a grant', () => {
  assert.equal(permanentPickProblem('Databricks is busy right now, so wait a minute and try again'), '');
  assert.equal(permanentPickProblem('[PERMISSION_DENIED] User does not have SELECT on Table amr_ali.sales.orders.'), '');
  assert.equal(permanentPickProblem(''), '');
  assert.equal(permanentPickProblem(undefined), '');
});

// REQ-180 (Data step): a picked table that reads no columns is dropped, renamed, or unreadable. The message names the table,
// and no Try again can change it. The backend text (unreadableTableError) must classify the same way.
const UNREADABLE = 'amr_ali.sales.orders has no columns Inspire can read. It was dropped or renamed, or your access does not include it. '
  + 'Swap it in Edit > Data step for the table you mean.';

test('a picked table that reads no columns is a permanent pick problem, named and without Try again', () => {
  assert.equal(permanentPickProblem(UNREADABLE), 'missing');
});
