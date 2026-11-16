// REQ-285: a status-only change (Mark my open done) never reads as the custom Merge choice, and only a row that carries the Merge choice
// is undone with the kind's word (Unmerge). Pure functions, no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choiceOf, rowChoiceId, undoWordOf } from '../src/records.js';

const ENTITY = [
  { id: 'merge', label: 'Merge', status: 'Done' },
  { id: 'review_later', label: 'Needs review', status: 'In progress' },
  { id: 'not_duplicate', label: 'Keep separate', status: 'Dismissed', reasons: ['Different company'] },
];
const RECORDS = { undo: 'Unmerge' };

test('a status-only Done row names no choice on a page whose only Done choice is Merge', () => {
  assert.equal(choiceOf(ENTITY, 'Done', null), null);
  assert.equal(choiceOf(ENTITY, 'Done', undefined), null);
});

test('an explicit Merge row still names Merge', () => {
  assert.equal(choiceOf(ENTITY, 'Done', 'merge').label, 'Merge');
});

test('a default status with one default choice still stands in for itself', () => {
  const plain = [{ id: 'new', label: 'New', status: 'New' }, { id: 'done', label: 'Done', status: 'Done' }];
  assert.equal(choiceOf(plain, 'Done', null)?.id, 'done');
});

test('the undo word names Unmerge only for a row that carries the Merge choice', () => {
  assert.equal(rowChoiceId({ _inspire_choice: 'merge' }), 'merge');
  assert.equal(rowChoiceId({ action_choice: 'merge' }), 'merge');
  assert.equal(rowChoiceId({ _inspire_choice: null, action_choice: null }), null);
  assert.equal(undoWordOf(rowChoiceId({ _inspire_choice: 'merge' }) ? RECORDS : {}, true), 'Unmerge');
  assert.equal(undoWordOf(rowChoiceId({ _inspire_choice: null }) ? RECORDS : {}, true), 'Reopen');
});
