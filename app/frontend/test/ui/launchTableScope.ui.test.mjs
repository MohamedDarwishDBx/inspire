import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until, waitForLaunchReady } from './uiSupport.mjs';

test.after(closeBrowser);

// The Launch scope under Data Management (REQ-363): a column search across the picked tables, row filters added from a row,
// row groups behind a row, and the label rules. The tree, the per-table grid and the column ticks are gone with the redesign.
const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const ORDERS = 'main.s.orders';
const RETURNS = 'main.s.returns';
const LABEL_BOX = 'Use case labeling enhanced using filters';
const LABEL_REASON = 'Add a row group above to label your use cases.';
const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 1280, height: 800 }];
const ORDER_COLUMNS = ['brand_name', 'location', 'total_sales', 'store_id'].map((column_name, i) => ({
  column_name, data_type: i === 2 ? 'DOUBLE' : 'STRING', ordinal_position: i + 1,
}));
const RETURN_COLUMNS = ['brand_name', 'reason'].map((column_name, i) => ({ column_name, data_type: 'STRING', ordinal_position: i + 1 }));
const STATE = {
  catalogs: ['main'],
  schemas: { main: ['s'] },
  tables: { 'main.s': ['orders', 'returns'] },
  columnsByTable: { [ORDERS]: ORDER_COLUMNS, [RETURNS]: RETURN_COLUMNS },
  valuesByColumn: { brand_name: ['Northwind', 'Costa'] },
  readinessByFilter: { Northwind: '120', Costa: '80', Nobody: '0' },
  groupCountsByColumn: {
    brand_name: [{ brand_name: 'Northwind', records: '120' }, { brand_name: 'Costa', records: '80' },
      { brand_name: 'Tokyo Tidbits', records: '60' }, { brand_name: 'Golden Gate Ginger', records: '40' }],
    location: [{ location: 'Store 1', records: '40' }, { location: 'Store 2', records: '30' }],
  },
};
const GROUP_BIG = Array.from({ length: 501 }, (_, i) => ({ brand_name: `brand ${i}`, records: String(1000 - i) }));

const launchOf = async (page, made) => {
  await idle(page);
  await page.getByRole('button', { name: 'Get Started' }).click();
  await page.locator('[data-launch-run-unsaved]').click();
  await until(() => made.launches.length === 1, 'the launch was sent once');
  return made.launches[0].params;
};
const search = (page) => page.getByRole('searchbox', { name: 'Search column names' });
const rowOf = (page, column, table = ORDERS) => page.locator(`[data-column-group="${column}"] [data-scope-row="${table}"]`);
const inUseOf = (page, table = ORDERS) => page.locator(`[data-filter-table="${table}"]`);
const rowsListed = (page, column) => page.locator(`[data-column-group="${column}"] [data-scope-row]`)
  .evaluateAll((els) => els.map((el) => el.getAttribute('data-scope-row')).sort());

async function findColumn(page, column) {
  await search(page).fill(column);
  await page.locator(`[data-column-group="${column}"]`).waitFor({ timeout: 15000 });
}

// Adds one row filter from the column's row in one table: the operator is "is" unless changed, the value is picked from the suggestions.
async function addFilter(page, column, value, table = ORDERS) {
  await rowOf(page, column, table).getByRole('button', { name: `Add row filter on ${column} in ${table.split('.').pop()}` }).click();
  await page.locator(`[data-scope-value="${value}"]`).waitFor({ timeout: 15000 });
  await page.locator(`[data-scope-value="${value}"]`).click();
  await page.getByRole('button', { name: 'Add filter' }).click();
}

async function openPickedOrders(page) {
  await page.getByPlaceholder(BUSINESS).fill('Acme');
  await page.locator('button[title="main"]').click();
  await page.locator('button[title="s"]').click();
  await page.locator('button[title="orders"]').click();
  await idle(page);
  await page.getByRole('button', { name: /Advanced Settings/ }).click();
  await page.getByRole('button', { name: /Data Management \(optional\)/ }).click();
  await search(page).waitFor({ timeout: 15000 });
}

async function loadGroups(page, column, table = ORDERS) {
  await rowOf(page, column, table).getByRole('button', { name: 'Row groups' }).click();
  await page.getByRole('button', { name: `Load groups for ${column}` }).click();
  await page.locator(`[data-row-groups="${column}"] [data-group-value]`).first().waitFor({ timeout: 15000 });
}

test('Data Management is an optional section, collapsed by default, and a search finds the columns of the picked table', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    await page.locator('button[title="orders"]').click();
    await idle(page);
    await page.getByRole('button', { name: /Advanced Settings/ }).click();
    const toggle = page.getByRole('button', { name: /Data Management \(optional\)/ });
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'collapsed by default');
    await toggle.click();
    await search(page).fill('brand');
    await page.locator('[data-column-group="brand_name"]').waitFor({ timeout: 15000 });
    assert.deepEqual(await rowsListed(page, 'brand_name'), [ORDERS], 'the search lists the picked table');
  } finally {
    await ui.close();
  }
});

test('a row filter found by search counts the rows and reaches the run with every column the table has', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await openPickedOrders(page);
    await findColumn(page, 'brand_name');
    await addFilter(page, 'brand_name', 'Northwind');
    await until(async () => (await inUseOf(page).innerText()).includes('120 rows match'), 'the live row count shows the rows the filter keeps');
    assert.equal(await inUseOf(page).locator('[data-scope-condition="brand_name"]').innerText(), 'brand_name: is Northwind', 'the condition shows as a chip');
    const params = await launchOf(page, made);
    assert.deepEqual(JSON.parse(params['17_table_scope']), {
      [ORDERS]: {
        columns: ['brand_name', 'location', 'total_sales', 'store_id'],
        rows: [{ column: 'brand_name', op: '=', values: ['Northwind'] }],
      },
    }, 'the run reads every column with the row filter, and no label because the box is not ticked');
  } finally {
    await ui.close();
  }
});

test('a column can carry more than one row filter, and each is removable on its own', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await openPickedOrders(page);
    await findColumn(page, 'brand_name');
    await rowOf(page, 'brand_name').getByRole('button', { name: 'Add row filter on brand_name in orders' }).click();
    await page.getByLabel('Operator for brand_name in orders').selectOption('!=');
    await page.locator('[data-scope-value="Costa"]').waitFor({ timeout: 15000 });
    await page.locator('[data-scope-value="Costa"]').click();
    await page.getByRole('button', { name: 'Add filter' }).click();
    await addFilter(page, 'brand_name', 'Northwind');
    assert.equal(await inUseOf(page).locator('[data-scope-condition="brand_name"]').count(), 2, 'two chips on one column');
    await page.getByRole('button', { name: 'Remove row filter on brand_name in orders: is not Costa' }).click();
    assert.equal(await inUseOf(page).locator('[data-scope-condition="brand_name"]').count(), 1, 'Remove drops one chip');
    const params = await launchOf(page, made);
    assert.deepEqual(JSON.parse(params['17_table_scope'])[ORDERS].rows, [{ column: 'brand_name', op: '=', values: ['Northwind'] }]);
  } finally {
    await ui.close();
  }
});

test('a row filter that keeps 0 rows blocks Get Started with the reason, and removing it sends no scope', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await openPickedOrders(page);
    await findColumn(page, 'brand_name');
    await rowOf(page, 'brand_name').getByRole('button', { name: 'Add row filter on brand_name in orders' }).click();
    await page.getByLabel('Value for brand_name in orders').fill('Nobody');
    await page.getByRole('button', { name: 'Add value' }).click();
    await page.getByRole('button', { name: 'Add filter' }).click();
    await until(async () => (await inUseOf(page).innerText()).includes('0 rows match'), 'the table says the filter keeps 0 rows');
    assert.equal(await page.getByRole('button', { name: 'Get Started' }).isDisabled(), true, 'a 0-row scope blocks the launch');
    assert.match(await inUseOf(page).locator('[role="alert"]').innerText(), /its row filters keep 0 rows, so Inspire will not run them. Change a filter/);
    await page.getByRole('button', { name: 'Remove row filter on brand_name in orders: is Nobody' }).click();
    await until(async () => (await inUseOf(page).count()) === 0, 'removing the filter leaves no table filter');
    const params = await launchOf(page, made);
    assert.equal('17_table_scope' in params, false, 'nothing is set, so the run reads the table whole');
  } finally {
    await ui.close();
  }
});

test('the label is filled in from the picked Row Groups only: a row filter alone leaves it empty, groups fill it', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await openPickedOrders(page);
    const text = page.getByRole('textbox', { name: 'Use case label', exact: true });
    assert.equal(await text.isDisabled(), true, 'the label box is disabled while no Row Group is picked');
    await findColumn(page, 'brand_name');
    await addFilter(page, 'brand_name', 'Northwind');
    await until(async () => (await inUseOf(page).innerText()).includes('120 rows match'), 'the brand filter counts its rows');
    assert.equal(await text.inputValue(), '', 'a row filter alone names nothing: the label stays empty');
    await loadGroups(page, 'brand_name');
    await page.locator('[data-group-value="Northwind"]').check();
    await until(async () => (await text.inputValue()) === 'Northwind', 'the picked group prefills the label, the row filter does not add to it');
    await page.getByRole('checkbox', { name: 'Use case labeling enhanced using filters' }).check();
    await text.fill('Northwind Cafe');
    const params = await launchOf(page, made);
    const scope = JSON.parse(params['17_table_scope']);
    assert.equal(scope.use_case_label, 'Northwind Cafe', 'the typed label is the label the run carries, verbatim');
    assert.deepEqual(scope[ORDERS].rows, [
      { column: 'brand_name', op: '=', values: ['Northwind'] },
      { column: 'brand_name', op: 'in', values: ['Northwind'], group: true },
    ]);
  } finally {
    await ui.close();
  }
});

test('with no Row Group the label box is disabled and says why, and a plain row filter does not enable it', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await openPickedOrders(page);
    const box = page.getByRole('checkbox', { name: LABEL_BOX });
    assert.equal(await box.isDisabled(), true, 'no picked table has a Row Group: the tick box is disabled');
    assert.equal(await page.getByRole('textbox', { name: 'Use case label', exact: true }).isDisabled(), true, 'the label text is disabled too');
    assert.equal(await page.locator('[data-use-case-label-reason]').innerText(), LABEL_REASON, 'the reason is shown in one line');
    await findColumn(page, 'brand_name');
    await addFilter(page, 'brand_name', 'Northwind');
    await until(async () => (await inUseOf(page).innerText()).includes('120 rows match'), 'the brand filter counts its rows');
    assert.equal(await box.isDisabled(), true, 'a row filter is not a Row Group: the box stays disabled');
  } finally {
    await ui.close();
  }
});

test('a Row Group enables the label box, and the launch text carries use_case_label', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await openPickedOrders(page);
    await findColumn(page, 'brand_name');
    await loadGroups(page, 'brand_name');
    const text = page.getByRole('textbox', { name: 'Use case label', exact: true });
    await page.locator('[data-group-value="Northwind"]').check();
    await until(async () => (await text.inputValue()) === 'Northwind', 'the picked group prefills the label');
    const box = page.getByRole('checkbox', { name: LABEL_BOX });
    assert.equal(await box.isDisabled(), false, 'a Row Group makes the box usable');
    assert.equal(await page.locator('[data-use-case-label-reason]').count(), 0, 'no reason is shown once the label is available');
    await box.check();
    await text.fill('Northwind Cafe');
    const params = await launchOf(page, made);
    assert.equal(JSON.parse(params['17_table_scope']).use_case_label, 'Northwind Cafe', 'the label reaches the table scope');
  } finally {
    await ui.close();
  }
});

test('a label ticked before its Row Group went away is not on and is not sent, and the typed text comes back with the group', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await openPickedOrders(page);
    await findColumn(page, 'brand_name');
    await loadGroups(page, 'brand_name');
    const text = page.getByRole('textbox', { name: 'Use case label', exact: true });
    const box = page.getByRole('checkbox', { name: LABEL_BOX });
    await page.locator('[data-group-value="Northwind"]').check();
    await box.check();
    await text.fill('Northwind Cafe');
    await page.locator('[data-group-value="Northwind"]').uncheck();
    await until(async () => box.isDisabled(), 'the group went away: the box is disabled');
    assert.equal(await box.isChecked(), false, 'the box does not look on without a Row Group');
    assert.equal(await page.locator('[data-use-case-label-reason]').innerText(), LABEL_REASON);
    assert.equal(await text.inputValue(), 'Northwind Cafe', 'the typed label is kept while the box is off');
    await page.locator('[data-group-value="Northwind"]').check();
    await until(async () => box.isDisabled().then((d) => !d), 'the group is back: the box is usable again');
    assert.equal(await box.isChecked(), false, 'it comes back unticked, not on by itself');
    assert.equal(await text.inputValue(), 'Northwind Cafe', 'the typed label comes back with the group');
    await page.locator('[data-group-value="Northwind"]').uncheck();
    await until(async () => box.isDisabled(), 'the group went away again before the launch');
    const params = await launchOf(page, made);
    const sent = params['17_table_scope'] ? JSON.parse(params['17_table_scope']) : {};
    assert.equal('use_case_label' in sent, false, 'no label is sent without a Row Group');
  } finally {
    await ui.close();
  }
});

test('Load groups lists a text column top 500 by row count, each value with its count', async () => {
  const ui = await openUi('launch', { ...STATE, groupCountsByColumn: { brand_name: GROUP_BIG } });
  const { page } = ui;
  try {
    await openPickedOrders(page);
    await findColumn(page, 'brand_name');
    await loadGroups(page, 'brand_name');
    assert.equal(await page.locator('[data-group-value]').count(), 500, 'at most 500 values are listed');
    assert.match(await page.locator('[data-row-groups="brand_name"]').innerText(), /500 values, the top 500 by rows/);
    assert.match(await page.locator('[data-group-value="brand 0"]').locator('xpath=..').innerText(), /1,000/, 'each value shows its row count');
  } finally {
    await ui.close();
  }
});

test('a long list of groups gets a search box, and the search narrows the list', async () => {
  const ui = await openUi('launch', { ...STATE, groupCountsByColumn: { brand_name: GROUP_BIG } });
  const { page } = ui;
  try {
    await openPickedOrders(page);
    await findColumn(page, 'brand_name');
    await loadGroups(page, 'brand_name');
    await page.getByRole('searchbox', { name: 'Search the groups of brand_name' }).fill('brand 49');
    assert.equal(await page.locator('[data-group-value]').count(), 11, 'brand 49 and brand 490 to 499 match');
  } finally {
    await ui.close();
  }
});

test('picked groups are one in row and show as chips; Done collapses them, and Change groups opens the list again', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await openPickedOrders(page);
    await findColumn(page, 'brand_name');
    await loadGroups(page, 'brand_name');
    await page.locator('[data-group-value="Northwind"]').check();
    await page.locator('[data-group-value="Costa"]').check();
    await until(async () => (await rowOf(page, 'brand_name').locator('[data-scope-group="brand_name"]').count()) === 2, 'each picked group is a chip');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    assert.equal(await page.locator('[data-row-groups="brand_name"] [data-group-value]').count(), 0, 'Done collapses the list');
    await page.getByRole('button', { name: 'Change groups', exact: true }).click();
    assert.equal(await page.locator('[data-row-groups="brand_name"] [data-group-value]').count(), 4, 'Change groups opens the list again');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    const params = await launchOf(page, made);
    assert.deepEqual(JSON.parse(params['17_table_scope'])[ORDERS].rows, [
      { column: 'brand_name', op: 'in', values: ['Northwind', 'Costa'], group: true },
    ], 'the picked groups are one in row, the agent reads it as is-one-of');
  } finally {
    await ui.close();
  }
});

test('the label names more than three picked groups as the first two and the rest counted', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await openPickedOrders(page);
    await findColumn(page, 'brand_name');
    await loadGroups(page, 'brand_name');
    const text = page.getByRole('textbox', { name: 'Use case label', exact: true });
    for (const value of ['Northwind', 'Costa', 'Tokyo Tidbits']) await page.locator(`[data-group-value="${value}"]`).check();
    await until(async () => (await text.inputValue()) === 'Northwind, Costa and Tokyo Tidbits', 'three groups join with commas and and');
    await page.locator('[data-group-value="Golden Gate Ginger"]').check();
    await until(async () => (await text.inputValue()) === 'Northwind and Costa and 2 more', 'four groups name two and count the rest');
  } finally {
    await ui.close();
  }
});

test('a numeric column gets no Load groups, and says row groups are for text columns', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await openPickedOrders(page);
    await findColumn(page, 'total_sales');
    const numeric = rowOf(page, 'total_sales');
    assert.match(await numeric.innerText(), /Row groups are for text columns/);
    assert.equal(await numeric.getByRole('button', { name: 'Row groups' }).count(), 0, 'numbers get no Row groups button');
  } finally {
    await ui.close();
  }
});

test('Load groups on a second column reads only the rows inside the groups already picked on the table', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await openPickedOrders(page);
    await findColumn(page, 'brand_name');
    await loadGroups(page, 'brand_name');
    await page.locator('[data-group-value="Northwind"]').check();
    await findColumn(page, 'location');
    await loadGroups(page, 'location');
    const last = [...made.sqlCalls].reverse().find((c) => c.sql.includes('ORDER BY records DESC'));
    assert.ok(last, 'the location groups were listed');
    assert.ok(last.sql.includes('IN ('), 'the statement narrows the location groups to the picked brand');
    assert.ok(last.parameters.some((p) => p.value === 'Northwind'), 'the picked brand group is the filter');
    assert.ok(last.sql.includes('`location` IS NOT NULL'), 'the list leaves the empty location out');
  } finally {
    await ui.close();
  }
});

// REQ-305: the search lists only the tables the Launch picks read, the same pickedScope the run reads.
async function pickThen(page, pick) {
  await page.getByPlaceholder(BUSINESS).fill('Acme');
  await pick(page);
  await idle(page);
  await page.getByRole('button', { name: /Advanced Settings/ }).click();
  await page.getByRole('button', { name: /Data Management \(optional\)/ }).click();
  await search(page).waitFor({ timeout: 15000 });
  await findColumn(page, 'brand_name');
}

test('REQ-305 a table picked under its schema, with the catalog picked: the search lists that one table, not the other tables of the schema', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await pickThen(page, async (p) => {
      await p.locator('button[title="main"]').click();
      await p.locator('button[title="s"]').click();
      await p.locator('button[title="orders"]').click();
    });
    for (const size of VIEWPORTS) {
      await page.setViewportSize(size);
      await until(async () => (await rowsListed(page, 'brand_name')).length >= 1, 'the search settles', 15000);
      assert.deepEqual(await rowsListed(page, 'brand_name'), [ORDERS], `${size.width}x${size.height}: only the picked table`);
    }
  } finally {
    await ui.close();
  }
});

test('REQ-305 a schema picked whole: the search lists every table of that schema, at 1440x900 and 1280x800', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await pickThen(page, async (p) => {
      await p.locator('button[title="main"]').click();
      await p.locator('button[title="s"]').click();
    });
    for (const size of VIEWPORTS) {
      await page.setViewportSize(size);
      await until(async () => (await rowsListed(page, 'brand_name')).length === 2, 'both tables of the schema are listed', 15000);
      assert.deepEqual(await rowsListed(page, 'brand_name'), [ORDERS, RETURNS], `${size.width}x${size.height}: the schema is read whole`);
    }
  } finally {
    await ui.close();
  }
});

test('REQ-305 a catalog picked whole: the search lists every table of every schema in it, at 1440x900 and 1280x800', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await pickThen(page, async (p) => { await p.locator('button[title="main"]').click(); });
    for (const size of VIEWPORTS) {
      await page.setViewportSize(size);
      await until(async () => (await rowsListed(page, 'brand_name')).length === 2, 'both tables of the catalog are listed', 15000);
      assert.deepEqual(await rowsListed(page, 'brand_name'), [ORDERS, RETURNS], `${size.width}x${size.height}: a whole catalog is read whole`);
    }
  } finally {
    await ui.close();
  }
});

test('a picked schema: a filter on one of its tables reaches the run under catalog.schema.table', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await pickThen(page, async (p) => {
      await p.locator('button[title="main"]').click();
      await p.locator('button[title="s"]').click();
    });
    await addFilter(page, 'brand_name', 'Northwind', ORDERS);
    await until(async () => (await inUseOf(page).innerText()).includes('120 rows match'), 'the filter counts its rows');
    const params = await launchOf(page, made);
    assert.deepEqual(JSON.parse(params['17_table_scope'])[ORDERS].rows, [{ column: 'brand_name', op: '=', values: ['Northwind'] }],
      'the scope holds the table of the schema pick under its catalog.schema.table key');
    assert.equal(params['01_uc_metadata'].includes('main.s'), true, 'the run reads the picked schema');
  } finally {
    await ui.close();
  }
});
