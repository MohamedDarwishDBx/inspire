// REQ-414 part B: the Work page's approval helpers. Approve needs no reason; Reject needs one, and a blank reason writes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approvalValues, isAwaitingApproval, APPROVAL_COLUMN, APPROVAL_NOTE_COLUMN, AWAITING_APPROVAL } from '../src/records.js';

test('only a row the agent job is waiting on shows the approval step', () => {
  assert.equal(isAwaitingApproval({ [APPROVAL_COLUMN]: AWAITING_APPROVAL }), true);
  assert.equal(isAwaitingApproval({ [APPROVAL_COLUMN]: 'approved' }), false, 'approved rows are not offered Approve again');
  assert.equal(isAwaitingApproval({ [APPROVAL_COLUMN]: 'rejected' }), false);
  assert.equal(isAwaitingApproval({}), false, 'a row without the approval column is not an agent kind row');
});

test('Approve writes the approved state with no reason', () => {
  assert.deepEqual(approvalValues('approve'), { [APPROVAL_COLUMN]: 'approved' });
});

test('Reject needs the reason: a blank or missing reason writes nothing', () => {
  assert.deepEqual(approvalValues('reject', '   '), { error: 'Give the reason for rejecting this row.' });
  assert.deepEqual(approvalValues('reject'), { error: 'Give the reason for rejecting this row.' });
  assert.deepEqual(approvalValues('reject', ' outside policy '), {
    [APPROVAL_COLUMN]: 'rejected', [APPROVAL_NOTE_COLUMN]: 'outside policy' });
});

test('an unknown decision is refused, never written', () => {
  assert.deepEqual(approvalValues('delete'), { error: 'Not an approval decision.' });
});
