// REQ-223 (b) and (c) / P52: Wake now clears a snooze on a row and in the drawer, and clearing the owner sends an empty owner.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { CURRENT, DECIDE, FIELDS, ROWS, TABLE, actBody, appInfo, lister, openApp, serveDist, tracked, until } from './harness.mjs';
import { actionForm, actionValues } from '../src/records.js';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const FUTURE = '2099-12-31';
const HUB = { today: '2026-10-24', quarter: '2026-10-01', since: '2026-08-03', errors: {},
  pages: { n01_u05: { visible: true, tracked: true, money: false, categories: [], served: 'delta', total: 3, truncated: false, runs: [], weeks: [], items: [] } } };

// One mutable list: the act and undo routes change it, the records route serves what it holds.
function book(rows) {
  const state = { rows: rows.map((r) => ({ ...r })), acts: [], undos: [], lists: [] };
  const records = lister((body) => { state.lists.push(body); return state.rows.map((r) => ({ ...r })); },
    { actions: true, changes: false, summary: { open: 1, done: 1, resolved: 0, left: 0, owners: [] }, as_of_us: '5555555555555555' });
  const act = ({ route, json }) => {
    const body = actBody(route);
    state.acts.push(body);
    for (const r of state.rows) {
      if (!body.record_keys.includes(String(r.record_key))) continue;
      if ('snooze_until' in body.values) r._inspire_snooze = body.values.snooze_until;
      if (body.values.action_status) r._inspire_status = body.values.action_status;
      if ('action_owner' in body.values) r._inspire_owner = body.values.action_owner;
      r._inspire_version = String(Number(r._inspire_version) + 1);
    }
    return json(200, { written: body.record_keys, conflicts: [] });
  };
  const undo = ({ route, json }) => {
    const body = route.request().postDataJSON();
    state.undos.push(body);
    const restored = state.rows.filter((r) => r._inspire_closed_batch === body.batch_id);
    restored.forEach((r) => { delete r._inspire_status; delete r._inspire_closed_batch; r._inspire_closed_can_undo = false; });
    return json(200, { restored: restored.map((r) => String(r.record_key)), skipped: [], left_out: 0 });
  };
  // The drawer reads the current version, so it shows the snooze the act wrote.
  const history = ({ json }) => {
    const row = state.rows[0];
    const current = { ...CURRENT, record_key: row.record_key, action_status: row._inspire_status || 'New', snooze_until: row._inspire_snooze || null,
      action_owner: row._inspire_owner || '' };
    return json(200, { record_key: row.record_key, fields: FIELDS, versions: [current], current, deleted: false, truncated: false });
  };
  return { state, routes: { ...tracked().routes, overview: ({ json }) => json(200, HUB), records, 'records/history': history, 'records/act': act, 'records/undo': undo } };
}

const SNOOZED = { ...ROWS[0], _inspire_status: 'New', _inspire_owner: 'amr@example.com', _inspire_snooze: FUTURE, _inspire_flag: 'ok' };

async function openWork(rows) {
  const { state, routes } = book(rows);
  const opened = await openApp(browser, served.base, appInfo({ ...DECIDE }, 1, { ...TABLE }), { routes, hash: '#/n01_u05/work' });
  await opened.page.locator('.card--table tbody tr .cell-t').first().waitFor({ timeout: 20000 });
  return { ...opened, state };
}

test('a snoozed row offers Wake now; the confirm repeats the word, the request clears the snooze, the list reloads and the record is Open', async () => {
  const { page, context, state } = await openWork([SNOOZED]);
  try {
    const wake = page.locator('[data-row-wake]');
    await wake.waitFor({ timeout: 10000 });
    assert.equal((await wake.innerText()).trim(), 'Wake now');
    await wake.click();
    const confirm = page.locator('.row-ask .btn--pri');
    await confirm.waitFor();
    assert.equal((await confirm.innerText()).trim(), 'Wake now');
    const lists = state.lists.length;
    await confirm.click();
    await until(() => state.acts.length === 1);
    assert.deepEqual(state.acts[0].record_keys, [SNOOZED.record_key]);
    assert.deepEqual(state.acts[0].values, { snooze_until: null });
    await until(() => state.lists.length > lists);
    await page.locator('[data-row-wake]').waitFor({ state: 'detached', timeout: 10000 });
    assert.equal(state.rows[0]._inspire_status, 'New', 'waking does not change the status: the record is Open');
  } finally {
    await context.close();
  }
});

test('a list sorted by a column still shows Wake now on a snoozed row, and the sorted request asks for the list with its sort', async () => {
  const { page, context, state } = await openWork([SNOOZED]);
  try {
    await page.locator('[data-row-wake]').waitFor({ timeout: 10000 });
    const asked = state.lists.length;
    await page.locator('.th-sort', { hasText: 'Rank' }).click();
    await until(() => state.lists.slice(asked).some((b) => b.sort));
    await page.locator('[data-row-wake]').waitFor({ timeout: 10000 });
    assert.equal((await page.locator('[data-row-wake]').innerText()).trim(), 'Wake now');
  } finally {
    await context.close();
  }
});

test('a row that is not snoozed offers no Wake now', async () => {
  const { page, context } = await openWork([{ ...SNOOZED, _inspire_snooze: null }]);
  try {
    await page.locator('.card--table tbody tr .cell-t').first().waitFor({ timeout: 10000 });
    assert.equal(await page.locator('[data-row-wake]').count(), 0);
  } finally {
    await context.close();
  }
});

test('the record drawer offers Wake now on a snoozed record and its confirm sends snooze_until null', async () => {
  const { page, context, state } = await openWork([SNOOZED]);
  try {
    await page.locator('.cell-t').first().click();
    const wake = page.locator('dialog[open] footer [data-wake]');
    await wake.waitFor({ timeout: 15000 });
    assert.equal((await wake.innerText()).trim(), 'Wake now');
    await wake.click();
    await page.locator('dialog[open] footer .row-ask .btn--pri').click();
    await until(() => state.acts.length === 1);
    assert.deepEqual(state.acts[0].values, { snooze_until: null });
    assert.equal(state.acts[0].record_keys[0], SNOOZED.record_key);
  } finally {
    await context.close();
  }
});

test('clearing the owner sends an empty action_owner, which unassigns the record', () => {
  const current = { action_owner: 'amr@example.com', action_status: 'New', action_due: null, action_note: '' };
  const form = { ...actionForm(current, 'amr@example.com'), owner: '   ' };
  assert.deepEqual(actionValues(current, form), { action_owner: '' });
});
