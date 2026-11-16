import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

// REQ-362, REQ-371: Data Management > Relationships. Two lists of the picked tables (Source, Target) sit side by side, with a Link button
// between them. Link opens a dialog with the columns of the two tables; the person pairs columns: one click on Link adds each pair. The links are listed and removable.
const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const ORDERS = 'main.s.orders';
const CUSTOMERS = 'main.s.customers';
const DECLARED = 'orders.customer_id → customers.customer_id';
const KEY = (_sql, parameters) => {
  const t = parameters.find((p) => p.name === 't').value;
  return { rows: t === 'orders' ? [{ column_name: 'customer_id', ref_catalog: 'main', ref_schema: 's', ref_table: 'customers', ref_column: 'customer_id' }] : [] };
};
const STATE = {
  catalogs: ['main'],
  schemas: { main: ['s'] },
  tables: { 'main.s': ['orders', 'customers'] },
  columnsByTable: {
    [ORDERS]: [{ column_name: 'order_id', data_type: 'BIGINT', ordinal_position: 1 }, { column_name: 'customer_id', data_type: 'BIGINT', ordinal_position: 2 },
      { column_name: 'amount', data_type: 'DECIMAL', ordinal_position: 3 }],
    [CUSTOMERS]: [{ column_name: 'customer_id', data_type: 'BIGINT', ordinal_position: 1 }, { column_name: 'name', data_type: 'STRING', ordinal_position: 2 }],
  },
  statements: { 'AS ref_table': KEY },
  primaryKeys: [],
};
const SHOTS = '/private/tmp/inspire_v15/shots/u4';
const SHOTS_U7 = '/private/tmp/inspire_v15/shots/u7';
const SHOTS_U13 = '/private/tmp/inspire_v15/shots/u13';

async function openRelationships(page, extra = []) {
  await page.getByPlaceholder(BUSINESS).fill('Acme');
  await page.locator('button[title="main"]').click();
  await page.locator('button[title="s"]').click();
  await page.locator('button[title="orders"]').click();
  await page.locator('button[title="customers"]').click();
  for (const table of extra) await page.locator(`button[title="${table}"]`).click();
  await idle(page);
  await page.getByRole('button', { name: /Advanced Settings/ }).click();
  await page.getByRole('button', { name: /Data Management \(optional\)/ }).click();
  await page.locator('[data-relationships]').waitFor({ timeout: 15000 });
}

// REQ-394: a third picked table lets the Source and Target lists move from A to B and back (a list cannot pick the other side's table).
const REFUNDS = 'main.s.refunds';
const STATE_WITH_REFUNDS = {
  ...STATE,
  tables: { 'main.s': ['orders', 'customers', 'refunds'] },
  columnsByTable: { ...STATE.columnsByTable, [REFUNDS]: [{ column_name: 'refund_id', data_type: 'BIGINT', ordinal_position: 1 }, { column_name: 'customer_id', data_type: 'BIGINT', ordinal_position: 2 }] },
};

const source = (page, name) => page.locator('[data-list="source"]').getByRole('button', { name, exact: true });
const target = (page, name) => page.locator('[data-list="target"]').getByRole('button', { name, exact: true });

test('two lists, Source and Target, sit side by side; Link is disabled with a reason until one table is on each side', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await openRelationships(page);
    assert.equal(await page.getByRole('button', { name: 'Link', exact: true }).isDisabled(), true);
    assert.match(await page.locator('[data-link-reason]').innerText(), /Pick one source table and one target table/);
    await source(page, 'orders').click();
    assert.equal(await page.getByRole('button', { name: 'Link', exact: true }).isDisabled(), true, 'one side alone is not enough');
    assert.equal(await target(page, 'orders').isDisabled(), true, 'the same table cannot be the target of its own link');
    await target(page, 'customers').click();
    assert.equal(await page.getByRole('button', { name: 'Link', exact: true }).isDisabled(), false);
    const lists = await page.evaluate(() => {
      const a = document.querySelector('[data-list="source"]').getBoundingClientRect();
      const b = document.querySelector('[data-list="target"]').getBoundingClientRect();
      return { sameRow: Math.abs(a.top - b.top) < 40, rightOf: b.left > a.left };
    });
    assert.deepEqual(lists, { sameRow: true, rightOf: true }, 'the two lists sit next to each other');
    for (const [width, height] of [[1440, 900], [1280, 800]]) {
      await page.setViewportSize({ width, height });
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(sideways <= 0, `no sideways scroll at ${width}x${height} (overflow ${sideways}px)`);
      await page.locator('[data-relationships]').screenshot({ path: `${SHOTS}/req371-lists-${width}x${height}.png` });
    }
  } finally {
    await ui.close();
  }
});

test('Link opens the dialog; one click on Link adds the pair at once, a declared key is added only by its button, and Close keeps every link', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await openRelationships(page);
    await source(page, 'orders').click();
    await target(page, 'customers').click();
    await page.getByRole('button', { name: 'Link', exact: true }).click();
    const dialog = page.locator('[data-link-dialog]');
    await dialog.getByRole('list', { name: 'Columns of orders' }).waitFor({ timeout: 15000 });
    await page.setViewportSize({ width: 1280, height: 800 });
    await dialog.screenshot({ path: `${SHOTS}/req376-dialog-1280x800.png` });
    const link = dialog.getByRole('button', { name: 'Link', exact: true });
    assert.equal(await link.isDisabled(), true);
    assert.match(await dialog.locator('[data-link-pick-reason]').innerText(), /Pick one column in each table/);
    assert.equal(await dialog.getByRole('button', { name: 'Done', exact: true }).count(), 0, 'there is no Done step');
    assert.equal(await dialog.getByRole('button', { name: 'Add link', exact: true }).count(), 0, 'there is no Add link step');
    await dialog.getByRole('list', { name: 'Columns of orders' }).getByRole('button', { name: 'amount', exact: true }).click();
    await dialog.getByRole('list', { name: 'Columns of customers' }).getByRole('button', { name: 'name', exact: true }).click();
    await link.click();
    assert.equal(await dialog.locator('[data-dialog-link="orders.amount → customers.name"]').count(), 1, 'the pair shows in the dialog at once');
    assert.equal(await page.locator('[data-relationship="orders.amount → customers.name"]').count(), 1, 'the pair is kept at once');
    const suggestion = dialog.locator(`[data-suggested-link="${DECLARED}"]`);
    assert.equal(await suggestion.count(), 1, 'the declared key is suggested in the dialog');
    assert.equal(await page.locator(`[data-relationship="${DECLARED}"]`).count(), 0, 'a suggestion is not added without a click');
    await dialog.getByRole('button', { name: `Add suggested link ${DECLARED}` }).click();
    assert.equal(await page.locator('[data-links]').getByText('Links (2)', { exact: true }).count(), 1, 'the running count shows both links');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    assert.equal(await page.locator('[data-link-dialog]').count(), 0, 'Close closes the dialog');
    assert.equal(await page.locator(`[data-relationship="${DECLARED}"]`).count(), 1, 'the declared key is kept after Close');
    assert.equal(await page.locator('[data-relationship="orders.amount → customers.name"]').count(), 1, 'the person pair is kept after Close');
    await page.locator('[data-links]').screenshot({ path: `${SHOTS}/req376-links-1280x800.png` }).catch(() => {});
    await page.getByRole('button', { name: `Remove relationship ${DECLARED}` }).click();
    assert.equal(await page.locator(`[data-relationship="${DECLARED}"]`).count(), 0, 'a link can be removed');
  } finally {
    await ui.close();
  }
});

test('the picks stay after a link, one table can be in many links, and Esc or a click outside keep every link', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await openRelationships(page);
    await source(page, 'orders').click();
    await target(page, 'customers').click();
    await page.getByRole('button', { name: 'Link', exact: true }).click();
    const dialog = page.locator('[data-link-dialog]');
    await dialog.getByRole('list', { name: 'Columns of orders' }).waitFor({ timeout: 15000 });
    await dialog.getByRole('list', { name: 'Columns of orders' }).getByRole('button', { name: 'amount', exact: true }).click();
    await dialog.getByRole('list', { name: 'Columns of customers' }).getByRole('button', { name: 'name', exact: true }).click();
    await dialog.getByRole('button', { name: 'Link', exact: true }).click();
    assert.equal(await source(page, 'orders').getAttribute('aria-pressed'), 'true', 'the Source pick stays');
    assert.equal(await target(page, 'customers').getAttribute('aria-pressed'), 'true', 'the Target pick stays');
    await dialog.getByRole('list', { name: 'Columns of orders' }).getByRole('button', { name: 'order_id', exact: true }).click();
    await dialog.getByRole('list', { name: 'Columns of customers' }).getByRole('button', { name: 'customer_id', exact: true }).click();
    await dialog.getByRole('button', { name: 'Link', exact: true }).click();
    assert.equal(await page.locator('[data-relationship]').count(), 2, 'one table is in two links');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-link-dialog]').count(), 0, 'Esc closes the dialog');
    assert.equal(await page.locator('[data-relationship]').count(), 2, 'Esc keeps both links');
    await page.getByRole('button', { name: 'Link', exact: true }).click();
    await page.locator('[data-link-dialog]').waitFor({ timeout: 5000 });
    await page.getByText('Relationships', { exact: true }).first().click();
    assert.equal(await page.locator('[data-link-dialog]').count(), 0, 'a click outside closes the dialog');
    assert.equal(await page.locator('[data-relationship]').count(), 2, 'an outside click keeps both links');
    assert.equal(await page.locator('[data-links]').getByText('Links (2)', { exact: true }).count(), 1);
  } finally {
    await ui.close();
  }
});

test('a relationship read that fails ends with the reason and Try again, not an endless read', async () => {
  const ui = await openUi('launch', { ...STATE, statements: { 'AS ref_table': KEY }, sqlErrors: { 'key_column_usage': '[PERMISSION_DENIED] User does not have USE SCHEMA on Schema main.s.' } });
  const { page } = ui;
  try {
    await openRelationships(page);
    await source(page, 'orders').click();
    await target(page, 'customers').click();
    await page.getByRole('button', { name: 'Link', exact: true }).click();
    const error = page.locator('[data-link-dialog] [role="alert"]');
    await error.waitFor({ timeout: 15000 });
    assert.match(await error.innerText(), /main\.s/, 'the reason names the schema');
    assert.equal(await page.locator('[data-link-loading]').count(), 0, 'the reading line is gone once the read has ended');
    assert.equal(await page.locator('[data-link-dialog]').getByRole('button', { name: 'Try again', exact: true }).count(), 1, 'Try again is offered');
  } finally {
    await ui.close();
  }
});

// REQ-370: an answer over the 2 MB cap is not silent. The Link dialog says how many tables have their columns sent, and the two tables
// being linked are always among them.
test('a wide 550-table pick: the Link dialog says how many tables have their columns sent, and still lists both linked tables', async () => {
  const names = Array.from({ length: 550 }, (_, i) => `t${String(i + 1).padStart(3, '0')}`);
  const wide = 'attribute_'.padEnd(90, 'x');
  const columnsByTable = Object.fromEntries(names.map((n) => [`main.s.${n}`,
    Array.from({ length: 60 }, (_, c) => ({ column_name: `${wide}${c}`, data_type: 'STRING', ordinal_position: c + 1 }))]));
  const ui = await openUi('launch', { ...STATE, tables: { 'main.s': names }, columnsByTable });
  const { page } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    await idle(page);
    await page.getByRole('button', { name: /Advanced Settings/ }).click();
    await page.getByRole('button', { name: /Data Management \(optional\)/ }).click();
    await source(page, 't001').click();
    await target(page, 't002').click();
    await page.getByRole('button', { name: 'Link', exact: true }).click();
    const dialog = page.locator('[data-link-dialog]');
    await dialog.locator('[data-link-note]').waitFor({ timeout: 30000 });
    assert.match(await dialog.locator('[data-link-note]').innerText(), /Columns are sent for \d+ of 550 tables/);
    assert.equal(await dialog.getByRole('list', { name: 'Columns of t001' }).getByRole('button').count(), 60, 'the source table is complete');
    assert.equal(await dialog.getByRole('list', { name: 'Columns of t002' }).getByRole('button').count(), 60, 'the target table is complete');
  } finally {
    await ui.close();
  }
});

// REQ-382: a long table name and two tables with the same name never push the Source and Target lists out of the section. Each list is a
// fixed height and scrolls; a name truncates with its full catalog.schema.table on hover; a shared name shows schema.table.
const LONG = 'customer_transaction_history_for_retail_segments_and_regions_2026_quarterly';
const SHARED_S = 'main.s.orders';
const SHARED_T = 'main.t.orders';
const COLS = (names) => names.map((n, i) => ({ column_name: n, data_type: 'BIGINT', ordinal_position: i + 1 }));
const SHARED_STATE = {
  ...STATE,
  schemas: { main: ['s', 't'] },
  tables: { 'main.s': [LONG, 'orders', 'customers'], 'main.t': ['orders'] },
  columnsByTable: { ...STATE.columnsByTable, [SHARED_T]: COLS(['order_id', 'region']) },
};
const sized = (page, selector) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  const r = el.getBoundingClientRect();
  return { scrollOver: el.scrollWidth - el.clientWidth, left: r.left, right: r.right, width: r.width };
}, selector);

test('REQ-382: long names truncate, Source and Target stay equal and inside the section at 1440x900 and 1280x800, and a shared name shows schema.table', async () => {
  const ui = await openUi('launch', SHARED_STATE);
  const { page } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    await page.locator('button[title="t"]').click();
    await idle(page);
    await page.getByRole('button', { name: /Advanced Settings/ }).click();
    await page.getByRole('button', { name: /Data Management \(optional\)/ }).click();
    await page.locator('[data-relationships]').waitFor({ timeout: 15000 });
    assert.equal(await source(page, LONG).getAttribute('title'), `main.s.${LONG}`, 'the full name is on hover');
    assert.equal(await source(page, 's.orders').count(), 1, 'a shared name shows its schema in the Source list');
    assert.equal(await target(page, 't.orders').count(), 1, 'a shared name shows its schema in the Target list');
    assert.equal(await source(page, 'orders').count(), 0, 'a shared name is never shown as its bare table name');
    for (const [width, height] of [[1440, 900], [1280, 800]]) {
      await page.setViewportSize({ width, height });
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(sideways <= 0, `${width}x${height}: no sideways scroll on the page (overflow ${sideways}px)`);
      const section = await sized(page, '[data-relationships]');
      assert.ok(section.scrollOver <= 0, `${width}x${height}: the section does not scroll sideways (overflow ${section.scrollOver}px)`);
      const src = await sized(page, '[data-list="source"] ul');
      const tgt = await sized(page, '[data-list="target"] ul');
      assert.ok(src.width > 0 && tgt.width > 0, `${width}x${height}: both lists are visible`);
      assert.ok(tgt.right <= section.right + 1, `${width}x${height}: the Target list ends inside the section`);
      assert.ok(Math.abs(src.width - tgt.width) <= 1, `${width}x${height}: the two lists are the same width (${src.width} vs ${tgt.width})`);
      await page.locator('[data-relationships]').screenshot({ path: `${SHOTS_U7}/req382-lists-${width}x${height}.png` });
    }
    await source(page, 'customers').click();
    await target(page, 't.orders').click();
    await page.getByRole('button', { name: 'Link', exact: true }).click();
    const dialog = page.locator('[data-link-dialog]');
    await dialog.getByRole('list', { name: 'Columns of t.orders' }).waitFor({ timeout: 15000 });
    assert.equal(await dialog.getAttribute('aria-label'), 'Link customers to t.orders', 'the dialog names the table that is shared, with its schema');
    for (const [width, height] of [[1440, 900], [1280, 800]]) {
      await page.setViewportSize({ width, height });
      const box = await sized(page, '[data-link-dialog]');
      assert.ok(box.scrollOver <= 0, `${width}x${height}: the Link dialog does not scroll sideways (overflow ${box.scrollOver}px)`);
      const left = await sized(page, '[data-link-dialog] ul[aria-label="Columns of customers"]');
      const right = await sized(page, '[data-link-dialog] ul[aria-label="Columns of t.orders"]');
      assert.ok(right.right <= box.right + 1 && left.width > 0 && right.width > 0, `${width}x${height}: both column lists are inside the dialog`);
      assert.ok(Math.abs(left.width - right.width) <= 1, `${width}x${height}: the two column lists are the same width`);
      await dialog.screenshot({ path: `${SHOTS_U7}/req382-dialog-${width}x${height}.png` });
    }
  } finally {
    await ui.close();
  }
});

test('a link whose reverse already exists is refused at Link with one plain line, and nothing is added (REQ-394)', async () => {
  const ui = await openUi('launch', STATE_WITH_REFUNDS);
  const { page } = ui;
  const refused = () => page.locator('[data-link-refused]');
  try {
    await openRelationships(page, ['refunds']);
    await source(page, 'orders').click();
    await target(page, 'customers').click();
    await page.getByRole('button', { name: 'Link', exact: true }).click();
    const dialog = page.locator('[data-link-dialog]');
    await dialog.getByRole('list', { name: 'Columns of orders' }).waitFor({ timeout: 15000 });
    await dialog.getByRole('list', { name: 'Columns of orders' }).getByRole('button', { name: 'customer_id', exact: true }).click();
    await dialog.getByRole('list', { name: 'Columns of customers' }).getByRole('button', { name: 'customer_id', exact: true }).click();
    await dialog.getByRole('button', { name: 'Link', exact: true }).click();
    assert.equal(await page.locator('[data-relationship="orders.customer_id → customers.customer_id"]').count(), 1, 'the first direction is kept');
    // The same pair again, in the same dialog, is refused.
    await dialog.getByRole('list', { name: 'Columns of orders' }).getByRole('button', { name: 'customer_id', exact: true }).click();
    await dialog.getByRole('list', { name: 'Columns of customers' }).getByRole('button', { name: 'customer_id', exact: true }).click();
    await dialog.getByRole('button', { name: 'Link', exact: true }).click();
    assert.equal(await refused().innerText(), 'orders.customer_id and customers.customer_id are already linked.');
    for (const [width, height] of [[1440, 900], [1280, 800]]) {
      await page.setViewportSize({ width, height });
      await dialog.screenshot({ path: `${SHOTS_U13}/req394-refused-${width}x${height}.png` });
    }
    // Move the lists to customers → orders through refunds, then try the reverse.
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await source(page, 'refunds').click();
    await target(page, 'orders').click();
    await source(page, 'customers').click();
    await page.getByRole('button', { name: 'Link', exact: true }).click();
    const reverse = page.locator('[data-link-dialog]');
    await reverse.getByRole('list', { name: 'Columns of customers' }).waitFor({ timeout: 15000 });
    await reverse.getByRole('list', { name: 'Columns of customers' }).getByRole('button', { name: 'customer_id', exact: true }).click();
    await reverse.getByRole('list', { name: 'Columns of orders' }).getByRole('button', { name: 'customer_id', exact: true }).click();
    await reverse.getByRole('button', { name: 'Link', exact: true }).click();
    assert.equal(await refused().innerText(), 'customers.customer_id and orders.customer_id are already linked.', 'the reverse is refused too');
    assert.equal(await page.locator('[data-relationship]').count(), 1, 'no duplicate link is listed');
    assert.equal(await page.locator('[data-links]').getByText('Links (1)', { exact: true }).count(), 1);
  } finally {
    await ui.close();
  }
});
