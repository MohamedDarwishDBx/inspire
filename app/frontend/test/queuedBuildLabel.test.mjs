import test from 'node:test';
import assert from 'node:assert/strict';
import { implementState } from '../src/lib/implementWizard.js';

// REQ-355: after Try again the build is queued until the job starts. The card must say queued, then running.
test('a queued build reads MVP queued, in the Building group, until its run starts (REQ-355)', () => {
  const state = implementState({ spec_version: 2, status: 'queued' });
  assert.equal(state.label, 'MVP queued');
  assert.equal(state.group, 'in_progress');
});

test('a build whose run has started reads MVP running (REQ-355 must-exclude: queued is not running, running is not queued)', () => {
  assert.equal(implementState({ spec_version: 2, status: 'building_outputs' }).label, 'MVP running');
  assert.equal(implementState({ spec_version: 2, status: 'filling' }).label, 'MVP running');
});
