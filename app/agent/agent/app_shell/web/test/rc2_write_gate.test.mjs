// REQ-288 round 3: a write that starts while another is in flight must never vanish. The gate queues it, so both land in order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWrite } from '../src/writeGate.js';

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

test('two overlapping writes both run, in order, and the second returns its own result', async () => {
  const order = [];
  const first = runWrite('undo:a', async () => { order.push('first:start'); await tick(30); order.push('first:end'); return 'A'; });
  const second = runWrite('undo:b', async () => { order.push('second:start'); return 'B'; });
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, 'A');
  assert.equal(b, 'B', 'the second write must land, not return undefined');
  assert.deepEqual(order, ['first:start', 'first:end', 'second:start']);
});

test('a nested write inside the running one still runs at once', async () => {
  const out = await runWrite('takeAll', async () => runWrite('choice:all', async () => 'inner', { inside: true }));
  assert.equal(out, 'inner');
});
