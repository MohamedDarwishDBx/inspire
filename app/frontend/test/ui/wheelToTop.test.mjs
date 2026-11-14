import test from 'node:test';
import assert from 'node:assert/strict';
import { wheelToTop } from './wheelScroll.mjs';

// The helper's scroll-settle loop runs in the browser; Node needs the same frame callback to run it here.
globalThis.requestAnimationFrame ??= (cb) => setTimeout(() => cb(performance.now()), 16);

// A fake region and page that behave like a scroller on a loaded CPU: each wheel step takes STEP_MS of wall time
// and moves the region by one notch (1000 px). The helper must keep wheeling while the region moves, however slow
// each step is, and must fail with a clear message when the wheel stops moving the region.
function scroller({ top, stepMs, moves = true }) {
  const el = { scrollTop: top };
  const region = { evaluate: async (fn, arg) => fn(el, arg) };
  const page = {
    mouse: {
      wheel: async (_dx, dy) => {
        await new Promise((done) => setTimeout(done, stepMs));
        if (moves) el.scrollTop = Math.max(0, el.scrollTop + dy);
      },
    },
  };
  return { el, page, region };
}

test('wheelToTop reaches the top when each wheel step is slow, as on a loaded CPU', async () => {
  const { el, page, region } = scroller({ top: 27000, stepMs: 200 });
  await wheelToTop(page, region, 'slow region');
  assert.equal(el.scrollTop, 0);
});

test('wheelToTop fails with a clear message when the wheel does not move the region', async () => {
  const { page, region } = scroller({ top: 5000, stepMs: 1, moves: false });
  await assert.rejects(wheelToTop(page, region, 'stuck region'), /stuck region: the wheel up does not bring the region back to its top \(scrollTop 5000\)/);
});
