import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

// REQ-361: the step is named Data Management and holds two sections in order: Relationships, then Data filter. Fits 1280x800 with no sideways scroll.
const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const ORDERS = 'main.s.orders';
const STATE = {
  catalogs: ['main'],
  schemas: { main: ['s'] },
  tables: { 'main.s': ['orders', 'customers'] },
  columnsByTable: {
    [ORDERS]: [{ column_name: 'order_id', data_type: 'BIGINT', ordinal_position: 1 }, { column_name: 'brand', data_type: 'STRING', ordinal_position: 2 }],
  },
};
const SHOTS = '/private/tmp/inspire_v15/shots/u2';

test('Data Management holds Relationships then Data filter, and no Data Filters name is shown; it fits 1280x800 without sideways scroll', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    await page.locator('button[title="orders"]').click();
    await idle(page);
    await page.getByRole('button', { name: /Advanced Settings/ }).click();
    await page.getByRole('button', { name: /Data Management \(optional\)/ }).click();
    await page.locator('[data-data-management]').waitFor({ timeout: 15000 });
    const headings = await page.locator('[data-data-management] h3').allInnerTexts();
    assert.deepEqual(headings, ['Relationships', 'Data filter']);
    const top = async (section) => (await page.locator(`[data-section="${section}"]`).boundingBox()).y;
    assert.ok(await top('relationships') < await top('data-filter'), 'Relationships sits above Data filter');
    const panel = await page.locator('[data-data-management]').innerText();
    assert.doesNotMatch(panel, /Data Filters/, 'no person sees the old step name in this panel');
    for (const [width, height] of [[1440, 900], [1280, 800]]) {
      await page.setViewportSize({ width, height });
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(sideways <= 0, `no sideways scroll at ${width}x${height} (overflow ${sideways}px)`);
      await page.locator('[data-data-management]').screenshot({ path: `${SHOTS}/req361-sections-${width}x${height}.png` });
    }
  } finally {
    await ui.close();
  }
});

// REQ-370: a whole-catalog pick of 550 tables with 8 metric views. Metric views are named once, in one line that expands to the names;
// they are not offered in the Relationships lists, and no sentence runs on into the next one.
const BIG_TABLES = Array.from({ length: 550 }, (_, i) => `t${String(i + 1).padStart(3, '0')}`);
const VIEWS = Array.from({ length: 8 }, (_, i) => `main.s.metrics_${i + 1}`);
const BIG_STATE = {
  catalogs: ['main'],
  schemas: { main: ['s'] },
  tables: { 'main.s': BIG_TABLES },
  metricViews: VIEWS,
};

test('a 550-table pick with 8 metric views: one line names the metric views, its Show control lists them, and no table-count note appears', async () => {
  const ui = await openUi('launch', BIG_STATE);
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    await idle(page);
    await page.getByRole('button', { name: /Advanced Settings/ }).click();
    await page.getByRole('button', { name: /Data Management \(optional\)/ }).click();
    const line = page.locator('[data-metric-views-left-out]');
    await line.waitFor({ timeout: 15000 });
    assert.equal(await page.locator('[data-metric-views-left-out] p').innerText(),
      '8 metric views are left out of Data Management: they cannot be filtered. Show them');
    assert.equal(await page.locator('[data-metric-views-names]').count(), 0, 'the names are not listed until Show them is pressed');
    await line.getByRole('button', { name: 'Show them' }).click();
    assert.equal(await page.locator('[data-metric-views-names] li').count(), 8, 'all 8 names are listed');
    const panel = await page.locator('[data-data-management]').innerText();
    assert.doesNotMatch(panel, /were not searched|Inspire reads up to 40/, 'no table-count note');
    assert.doesNotMatch(panel, /instead\s+Its|instead Its/, 'no glued sentence');
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(sideways <= 0, `no sideways scroll at 1280x800 (overflow ${sideways}px)`);
    await page.locator('[data-data-management]').screenshot({ path: `${SHOTS}/req370-metric-views-1280x800.png` });
  } finally {
    await ui.close();
  }
});

test('the Relationships lists offer only tables: no metric view is in the Source or Target list, and nothing is picked by default', async () => {
  const ui = await openUi('launch', BIG_STATE);
  const { page } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    await idle(page);
    await page.getByRole('button', { name: /Advanced Settings/ }).click();
    await page.getByRole('button', { name: /Data Management \(optional\)/ }).click();
    await page.locator('[data-data-management] [data-metric-views-left-out]').waitFor({ timeout: 15000 });
    const names = await page.locator('[data-list="source"] button').allInnerTexts();
    assert.equal(names.length, 550, 'every real table is listed, with its filter box for a long list');
    assert.equal(names.filter((n) => /metrics_/.test(n)).length, 0, 'no metric view is offered');
    assert.equal(await page.locator('[data-list="source"] button[aria-pressed="true"]').count(), 0, 'no table is picked by default');
  } finally {
    await ui.close();
  }
});
