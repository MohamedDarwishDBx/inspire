// REQ-284 (P81): "Not written: X" names only documents. A failed analysis step reads "X did not finish: <reason>".
// Fail-pre: before the fix, Strategy Alignment reached missingDocuments as "Not written: Strategy Alignment."
import test from 'node:test';
import assert from 'node:assert/strict';
import { runOutcomeOf, unfinishedStepsOf, missingDocumentsOf } from '../src/lib/runOutcome.js';

const ALIGNMENT_ERROR = '8 use cases kept placeholder KPIs and benefits after the retries: N01-U01, N02-U01, N04-U02';

test('a failed Strategy Alignment step never reads as a document that was not written (must-exclude)', () => {
  const results = { run_status: 'warning', failed_steps: [{ step: 'Strategy Alignment', language: '', error: ALIGNMENT_ERROR }] };
  assert.deepEqual(missingDocumentsOf(results), []);
  assert.doesNotMatch(JSON.stringify(runOutcomeOf(results).missingDocuments), /Not written/);
});

test('the failed analysis step says what happened, with its own reason', () => {
  const results = { run_status: 'warning', failed_steps: [{ step: 'Strategy Alignment', language: '', error: ALIGNMENT_ERROR }] };
  assert.deepEqual(unfinishedStepsOf(results), [`Strategy Alignment did not finish: ${ALIGNMENT_ERROR}`]);
  const outcome = runOutcomeOf(results);
  assert.deepEqual(outcome.unfinishedSteps, [`Strategy Alignment did not finish: ${ALIGNMENT_ERROR}`]);
  assert.equal(outcome.warning, true, 'a run with an unfinished step is a warning, never "Run finished"');
});

test('a failed document still reads as not written', () => {
  const results = { failed_steps: [{ step: 'CSV Catalog', language: 'Arabic', error: 'x' }, { step: 'Strategy Alignment', language: '', error: 'y' }] };
  assert.deepEqual(missingDocumentsOf(results), ['Not written in Arabic: CSV.']);
  assert.deepEqual(unfinishedStepsOf(results), ['Strategy Alignment did not finish: y']);
});

test('a failed step with no error text still reads as finished-with-no-reason, not as a document', () => {
  assert.deepEqual(unfinishedStepsOf({ failed_steps: [{ step: 'Best of Best', language: '', error: '' }] }), ['Best of Best did not finish.']);
});
