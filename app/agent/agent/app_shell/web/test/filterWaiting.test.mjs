// REQ-131: a filter load refused for access keeps the waiting state, so the App shows the grant with Copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { filtersFailure, waitingError } from '../src/api.js';

test('a refused filter load keeps its waiting state and the access message', () => {
  const error = waitingError({ state: 'waiting_for_access', message: 'This App is waiting for access to its data.', tables: ['c.s.t'], owners: ['owner'], detail: 'no access' });
  const meta = filtersFailure(error);
  assert.deepEqual(meta.filters, []);
  assert.equal(meta.error, 'This App is waiting for access to its data.');
  assert.equal(meta.waiting.tables[0], 'c.s.t');
});

test('an ordinary filter failure keeps the plain message and no waiting state', () => {
  const meta = filtersFailure(new Error('warehouse stopped'));
  assert.deepEqual(meta, { filters: [], error: 'warehouse stopped' });
});
