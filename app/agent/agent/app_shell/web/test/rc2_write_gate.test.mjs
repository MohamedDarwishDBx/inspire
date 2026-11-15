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

test('a repeat of the same write while it is in flight joins it: the double click sends one write and both presses get its result', async () => {
  let sent = 0;
  const write = async () => { sent += 1; await tick(20); return 'once'; };
  const [a, b] = await Promise.all([runWrite('work:done:r1', write), runWrite('work:done:r1', write)]);
  assert.equal(sent, 1, 'the second press of the same write sends nothing new');
  assert.equal(a, 'once');
  assert.equal(b, 'once');
  assert.equal(await runWrite('work:done:r1', write), 'once', 'once it has landed the same key runs again');
  assert.equal(sent, 2);
});
