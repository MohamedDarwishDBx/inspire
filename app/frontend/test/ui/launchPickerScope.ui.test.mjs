import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';

test.after(closeBrowser);

const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const STATE = {
  catalogs: ['main', 'samples'],
  schemas: { main: ['s', 'x'], samples: ['bakehouse'] },
  tables: { 'main.s': ['orders', 'customers'], 'main.x': ['stock'], 'samples.bakehouse': ['sales'] },
};
const launchOf = async (page, made) => {
  await idle(page);
  await page.getByRole('button', { name: 'Get Started' }).click();
  await until(() => made.launches.length === 1, 'the launch was sent once');
  return made.launches[0].params;
};
const WHOLE_CATALOG = /whole catalog/;
const SCOPE_IN = /is in scope/;

test('a schema picked then unpicked leaves nothing in scope: "Nothing picked yet", no whole-catalog line, Launch disabled (must-exclude)', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    await idle(page);
    assert.equal(await page.getByText('1 schema', { exact: true }).count() > 0, true, 'the schema pick reads as one schema');
    await page.locator('button[title="s"]').click();
    await idle(page);
    assert.equal(await page.getByText(WHOLE_CATALOG).count(), 0, 'no line calls the catalog whole');
    assert.equal(await page.getByText(SCOPE_IN).count(), 0, 'no line says anything is in scope');
    await page.getByText('Nothing picked yet', { exact: true }).waitFor({ timeout: 15000 });
    assert.equal(await page.getByText('Selected Metadata', { exact: true }).count(), 0, 'the basket stays hidden with nothing picked');
    assert.equal(await page.getByRole('button', { name: 'Get Started' }).isDisabled(), true, 'Launch is disabled with nothing picked');
    await page.locator('[data-launch-block]').waitFor({ timeout: 15000 });
  } finally {
    await ui.close();
  }
});

test('a table picked under a schema after the schema pick is the one table in scope, with no schema or catalog wording (must-keep)', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    await page.locator('button[title="orders"]').waitFor({ timeout: 15000 });
    await page.locator('button[title="orders"]').click();
    await idle(page);
    assert.equal(await page.getByText('1 table', { exact: true }).count() > 0, true, 'the scope line says 1 table');
    assert.equal(await page.getByText(/1 table, 1 schema|1 schema, 1 table|whole catalog/).count(), 0, 'no schema or catalog wording beside the table');
    const params = await launchOf(page, made);
    assert.equal(params['01_uc_metadata'], 'main.s.orders', 'the run reads exactly the one table');
  } finally {
    await ui.close();
  }
});

test('a table picked under an opened catalog then unpicked from the basket leaves nothing in scope, not the catalog (must-exclude)', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    await page.locator('button[title="orders"]').waitFor({ timeout: 15000 });
    await page.locator('button[title="orders"]').click();
    await page.locator('button[title="s"]').click();
    await idle(page);
    assert.equal(await page.getByText('1 table', { exact: true }).count() > 0, true, 'with the schema off, the picked table is still the scope');
    await page.getByRole('button', { name: 'Remove main.s.orders' }).click();
    await page.getByText('Nothing picked yet', { exact: true }).waitFor({ timeout: 15000 });
    await idle(page);
    assert.equal(await page.getByText(WHOLE_CATALOG).count(), 0, 'the opened catalog is not read whole once its table is unpicked');
    assert.equal(await page.getByRole('button', { name: 'Get Started' }).isDisabled(), true);
  } finally {
    await ui.close();
  }
});

test('a catalog picked alone is still read whole and its line says so (must-keep)', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('button[title="main"]').click();
    const line = page.getByText(/^The whole catalog main is in scope/).first();
    await line.waitFor({ timeout: 15000 });
    const params = await launchOf(page, made);
    assert.equal(params['01_uc_metadata'], 'main', 'the catalog picked whole is read whole');
  } finally {
    await ui.close();
  }
});
