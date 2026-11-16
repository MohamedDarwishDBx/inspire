import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';

test.after(closeBrowser);

// REQ-242 on the real path: a Data Filter set on a samples table, then Copy into a schema the person owns, then Get Started. The run
// must send the scope under the copy's name, because the run reads the copy (the samples table cannot be measured).
const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const SOURCE = 'samples.bakehouse.sales_franchises';
const DESTINATION = 'inspire_kinds_rc7._inspire';
const COPY = `${DESTINATION}.bakehouse__sales_franchises`;
const COLUMNS = ['franchiseID', 'name', 'country', 'brand_name'].map((column_name, i) => ({
  column_name, data_type: i === 0 ? 'BIGINT' : 'STRING', ordinal_position: i + 1,
}));
const STATE = {
  catalogs: ['main', 'samples'],
  schemas: { main: ['s'], samples: ['bakehouse'] },
  tables: { 'main.s': ['orders'], 'samples.bakehouse': ['sales_franchises'] },
  columnsByTable: { [SOURCE]: COLUMNS, [COPY]: COLUMNS },
  valuesByColumn: { brand_name: ['Northwind', 'Costa'] },
  readinessByFilter: { Northwind: '120', Nobody: '0' },
  groupCountsByColumn: {
    brand_name: [{ brand_name: 'Northwind', records: '120' }, { brand_name: 'Costa', records: '80' }],
  },
  // The copy answers with the name the server gives it (sampleCopyName: destination + source schema + table).
  sampleCopyAnswer: [200, { destination: DESTINATION, copies: [{ source: SOURCE, copy: COPY }], failed: [] }],
};

// The copy's columns are read from the copy table, which the shared harness does not serve: answer with the same columns.
const mount = (app) => {
  app.get('/api/inspire/implement/columns', (req, res) => res.json({
    table: req.query.table, tags_read: true, primary_keys: [],
    columns: COLUMNS.map((c) => ({ ...c, tags: {}, personal: false })),
  }));
};


async function pickSampleAndOpenDataFilters(page) {
  await page.getByPlaceholder(BUSINESS).fill('Acme');
  await page.locator('button[title="samples"]').click();
  await page.locator('button[title="bakehouse"]').click();
  await page.locator('button[title="sales_franchises"]').click();
  await idle(page);
  await page.getByRole('button', { name: /Advanced Settings/ }).click();
  await page.getByRole('button', { name: /Data Management \(optional\)/ }).click();
  await page.getByRole('searchbox', { name: 'Search column names' }).fill('brand_name');
  await page.locator(`[data-column-group="brand_name"] [data-scope-row="${SOURCE}"]`).waitFor({ timeout: 15000 });
}

test('Copy into carries the Data Filter to the copy, and Get Started sends the scope under the copy name', async () => {
  const ui = await openUi('launch', STATE, '', { mount });
  const { page, made } = ui;
  try {
    await pickSampleAndOpenDataFilters(page);
    await page.getByRole('button', { name: `Add row filter on brand_name in ${SOURCE.split('.').pop()}` }).click();
    await page.locator('[data-scope-value="Northwind"]').waitFor({ timeout: 15000 });
    await page.locator('[data-scope-value="Northwind"]').click();
    await page.getByRole('button', { name: 'Add filter' }).click();

    await page.locator('[data-samples-offer]').waitFor({ timeout: 15000 });
    await page.locator('input[placeholder="catalog.schema you own"]').fill(DESTINATION);
    await page.locator('[data-samples-copy]').click();
    await page.locator('[data-samples-copied]').waitFor({ timeout: 15000 });
    await until(() => made.sampleCopies.length === 1, 'the copy was requested once');

    const sent = await launchParams(page, made);
    assert.ok(sent['17_table_scope'], 'the copy path sends a Table Scope');
    const scope = JSON.parse(sent['17_table_scope']);
    assert.deepEqual(Object.keys(scope), [COPY], 'the scope is keyed by the copy the run reads, not by the samples table');
    assert.deepEqual(scope[COPY].rows, [{ column: 'brand_name', op: '=', values: ['Northwind'] }]);
    assert.ok(sent['01_uc_metadata'].includes(DESTINATION), 'the run reads the copy, under the destination schema');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

async function launchParams(page, made) {
  await idle(page);
  await page.getByRole('button', { name: 'Get Started' }).click();
  await page.locator('[data-launch-run-unsaved]').click();
  await until(() => made.launches.length === 1, 'the launch was sent once');
  return made.launches[0].params;
}
