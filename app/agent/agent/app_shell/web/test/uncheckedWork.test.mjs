// REQ-224: a row the notebook could not check is never Open. The Work tab "Could not be checked" counts those rows, lists only
// those rows, and shows each row's own data_quality_flag as its reason.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DECIDE, ROWS, TABLE, appInfo, lister, openApp, serveDist, tracked, until } from './harness.mjs';
import { OPEN_STATUSES } from '../src/records.js';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const OPEN_ROW = { ...ROWS[0], _inspire_status: null, _inspire_flag: 'ok' };
const UNCHECKED = [
  { ...ROWS[1], _inspire_status: 'In progress', _inspire_flag: 'no candidate pair' },
  { ...ROWS[2], _inspire_status: null, _inspire_flag: null },
];
const COUNTS = { open: 1, unchecked: 2, watch: 0, all: 3, mine: 0, choices: {}, statuses: {} };

// A tracked decision page: its overview entry says the page keeps actions, so the Work tab bar renders.
const HUB = { today: '2026-10-24', quarter: '2026-10-01', since: '2026-08-03', errors: {},
  pages: { n01_u05: { visible: true, tracked: true, money: false, categories: [], served: 'delta', total: 3, truncated: false, runs: [], weeks: [], items: [] } } };

function routes(seen) {
  return tracked({
    overview: ({ json }) => json(200, HUB),
    records: lister((body) => { seen.push(body); return body.unchecked ? UNCHECKED : [OPEN_ROW]; },
      { actions: true, changes: false, summary: null, status_counts: COUNTS }),
  }).routes;
}

async function openWork(seen) {
  const opened = await openApp(browser, served.base, appInfo({ ...DECIDE }, 1, { ...TABLE }), { routes: routes(seen), hash: '#/n01_u05/work' });
  await opened.page.locator('[data-tab="open"]').waitFor({ timeout: 20000 });
  return opened;
}

test('the Work tab bar offers Could not be checked with its own count, next to Open', async () => {
  const seen = [];
  const { page, context } = await openWork(seen);
  try {
    const tab = page.locator('[data-tab="unchecked"]');
    await tab.waitFor();
    assert.equal((await tab.innerText()).replace(/\s+/g, ' ').trim(), 'Could not be checked 2');
    assert.equal((await page.locator('[data-tab="open"] [data-count]').innerText()).trim(), '1');
  } finally {
    await context.close();
  }
});

test('the Could not be checked tab lists only the unchecked rows, each with its own reason', async () => {
  const seen = [];
  const { page, context } = await openWork(seen);
  try {
    await page.locator('[data-tab="unchecked"]').click();
    await until(() => seen.some((b) => b.unchecked === true));
    await page.locator('[data-unchecked-why]').first().waitFor({ timeout: 10000 });
    const reasons = await page.locator('[data-unchecked-why]').allInnerTexts();
    assert.deepEqual(reasons.map((t) => t.trim()), ['No candidate pair', 'No reason was recorded']);
  } finally {
    await context.close();
  }
});

test('the Open tab never includes an unchecked row: its request filters open statuses and no unchecked flag, and an ok row stays Open', async () => {
  const seen = [];
  const { page, context } = await openWork(seen);
  try {
    await until(() => seen.some((b) => !b.unchecked));
    await page.locator('.card--table tbody tr').first().waitFor({ timeout: 10000 });
    const open = seen.filter((b) => !b.unchecked).at(-1);
    assert.equal(open.unchecked, undefined, 'the Open request carries no unchecked filter');
    assert.deepEqual(open.column_filters?.action_status, OPEN_STATUSES);
    assert.equal(await page.locator('[data-unchecked-why]').count(), 0, 'the Open list shows no unchecked reason column');
    assert.equal(await page.locator('.card--table tbody tr').count(), 1, 'the Open list shows its one ok row');
  } finally {
    await context.close();
  }
});
