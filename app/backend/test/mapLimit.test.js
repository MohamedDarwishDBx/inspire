const test = require('node:test');
const assert = require('node:assert/strict');
const { mapLimit } = require('../lib/mapLimit');

test('mapLimit keeps at most the limit in flight and returns results in input order (REQ-323)', async () => {
  let inFlight = 0;
  let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 8, async (n) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5 * (13 - n)));
    inFlight -= 1;
    return n * 2;
  });
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24]);
  assert.equal(peak, 8, 'a cap of 8 is reached and never passed');
});

test('mapLimit runs every item when the list is shorter than the limit, and an empty list resolves empty (REQ-323)', async () => {
  assert.deepEqual(await mapLimit([1, 2], 8, async (n) => n), [1, 2]);
  assert.deepEqual(await mapLimit([], 8, async () => { throw new Error('never called'); }), []);
});

test('mapLimit rejects when one call rejects, so a failed row fails the read as Promise.all did (REQ-323)', async () => {
  await assert.rejects(mapLimit([1, 2, 3], 2, async (n) => { if (n === 2) throw new Error('row 2'); return n; }), /row 2/);
});
