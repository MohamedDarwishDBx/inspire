import test from 'node:test';
import assert from 'node:assert/strict';
import { wheelToBottom, wheelToTop } from './wheelScroll.mjs';

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

// A region whose content grows once, right after the wheel first reaches its end (rows or a chart that render late under
// CPU load). The rc2 App-shell run on c89b1a166 stopped 3 px short this way. wheelToBottom must re-read the end and resume.
function growingScroller({ height, client, growBy }) {
  const el = { scrollTop: 0, scrollHeight: height, clientHeight: client };
  let grown = false;
  const region = { evaluate: async (fn, arg) => fn(el, arg) };
  const page = {
    mouse: {
      wheel: async (_dx, dy) => {
        el.scrollTop = Math.min(el.scrollHeight - el.clientHeight, Math.max(0, el.scrollTop + dy));
        if (!grown && el.scrollHeight - el.clientHeight - el.scrollTop <= 2) {
          grown = true;
          setTimeout(() => { el.scrollHeight += growBy; }, 60);
        }
      },
    },
  };
  return { el, page, region };
}

test('wheelToBottom resumes when the region grows after the wheel first reached its end', async () => {
  const { el, page, region } = growingScroller({ height: 2249, client: 700, growBy: 600 });
  await wheelToBottom(page, region);
  assert.ok(el.scrollHeight - el.clientHeight - el.scrollTop <= 2, `stopped at ${el.scrollTop} of ${el.scrollHeight - el.clientHeight}`);
});

test('wheelToBottom stops when the wheel does not move the region (must-exclude: bounded, no endless wheel)', async () => {
  const el = { scrollTop: 0, scrollHeight: 3000, clientHeight: 700 };
  const region = { evaluate: async (fn, arg) => fn(el, arg) };
  const page = { mouse: { wheel: async () => {} } };
  const started = Date.now();
  await wheelToBottom(page, region);
  assert.equal(el.scrollTop, 0);
  assert.ok(Date.now() - started < 60000, 'the stall bound ends the loop');
});
