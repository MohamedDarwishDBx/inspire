import test from 'node:test';
import assert from 'node:assert/strict';
import { carriedStart, trackBuildSubmit, withPendingBuilds } from '../src/lib/implementControl.js';
import { mvpProgressSummary } from '../src/lib/mvpProgress.js';

// REQ-395: the build timer counts from the click. The server's start (a few seconds later) must not move the timer back.
const T0 = Date.parse('2026-11-16T22:00:00Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();
const ID = 'uc-timer-a';
const span = (row, now) => mvpProgressSummary([], row, { now }).span;

test('the queued row times from the click; the server answer at t0+7 s keeps the timer on the click (REQ-395)', async () => {
  const now18 = T0 + 18000;
  // Click at t0; the server answers queued version 5 about 7 s later. Both calls carry the click time, as trackBuildSubmit does.
  const pending = trackBuildSubmit({ use_case_id: ID, use_case_name: 'Timer' }, async () => ({ use_case_id: ID, spec_version: 5 }), null, T0);
  const waiting = withPendingBuilds([], now18).find((r) => r.use_case_id === ID);
  await pending;
  const before = span(waiting, now18);
  assert.equal(before, 'Running for 18s', 'the overlay times from the click');
  // The server's own row for version 5 starts at t0+7 s and is still queued: the history read lands it.
  const serverRow = { use_case_id: ID, spec_version: 5, status: 'queued', created_at: at(7) };
  const landed = withPendingBuilds([serverRow], now18).find((r) => r.use_case_id === ID);
  assert.equal(landed.created_at, at(0), 'the landed row carries the click as its start, not the server start');
  assert.equal(span(landed, now18), before, 'the elapsed time does not drop from 18 s to 11 s when the server answers');
});

test('the status read of the detail panel keeps the click start for the same version (REQ-395)', async () => {
  const id = 'uc-timer-b';
  await trackBuildSubmit({ use_case_id: id, use_case_name: 'Status' }, async () => ({ use_case_id: id, spec_version: 5 }), null, T0);
  const statusRow = { use_case_id: id, spec_version: 5, status: 'queued', created_at: at(7) };
  const shown = carriedStart(statusRow, id);
  assert.equal(shown.created_at, at(0));
  assert.equal(span(shown, T0 + 25000), 'Running for 25s', 'the panel keeps counting from the click after the answer');
});

test('a later version is not carried back to the earlier click: the timer of a new build starts at its own start (REQ-395 must-exclude)', async () => {
  const id = 'uc-timer-c';
  await trackBuildSubmit({ use_case_id: id, use_case_name: 'Later' }, async () => ({ use_case_id: id, spec_version: 5 }), null, T0);
  const v6 = { use_case_id: id, spec_version: 6, status: 'queued', created_at: at(40) };
  assert.equal(carriedStart(v6, id), v6, 'version 6 is a new build, its own start stands');
});

test('the carried click start survives a reload of the tab, so the timer never restarts from the server start (REQ-395)', async () => {
  const store = new Map();
  globalThis.sessionStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  try {
    const before = await import('../src/lib/implementControl.js?timer=before');
    await before.trackBuildSubmit({ use_case_id: 'uc-timer-reload', use_case_name: 'Reload' }, async () => ({ use_case_id: 'uc-timer-reload', spec_version: 2 }), null, T0);
    before.withPendingBuilds([{ use_case_id: 'uc-timer-reload', spec_version: 2, status: 'queued', created_at: at(7) }], T0 + 9000);
    const after = await import('../src/lib/implementControl.js?timer=after');
    const shown = after.carriedStart({ use_case_id: 'uc-timer-reload', spec_version: 2, status: 'queued', created_at: at(7) }, 'uc-timer-reload');
    assert.equal(shown.created_at, at(0));
  } finally {
    delete globalThis.sessionStorage;
  }
});
