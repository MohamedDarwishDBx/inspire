import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai', hasServerPlatformAuth: true };
const CATALOGS = { catalogs: ['finance', 'hr', 'main', 'sales'], schemas: { main: ['s'], sales: ['gold'], hr: ['people'], finance: ['ledger'] } };
const withInstaller = (installerDataCatalogs) => (app) => {
  app.get('/api/defaults', (_req, res) => res.json(installerDataCatalogs === undefined ? DEFAULTS : { ...DEFAULTS, installerDataCatalogs }));
  app.get('/api/showcase', (_req, res) => res.json({}));
};
const LOAD_ALL = 'Load all catalogs';
const INSTALLER_ONLY = 'Installer catalogs only';
const NO_DATA = /I don.t have data/;

// The real App: Get Started, then "I have data in Unity Catalog", which opens the Discover launch page.
async function openLaunch(installerDataCatalogs) {
  const ui = await openUi('app', { ...REVIEW_STATE, ...CATALOGS }, '', { mount: withInstaller(installerDataCatalogs) });
  const { page } = ui;
  await page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
  await page.locator('[data-start-choice="data"]').click();
  await page.waitForFunction(() => window.location.hash === '#/launch', null, { timeout: 20000 });
  await page.locator('h1').first().waitFor();
  await idle(page);
  return ui;
}
const listed = (page) => page.locator('button[title="finance"], button[title="hr"], button[title="main"], button[title="sales"]')
  .evaluateAll((els) => els.map((el) => el.getAttribute('title')).sort());

test('the Catalogs list shows the catalogs picked at install by default, Load all shows every catalog above the list, and Installer catalogs only goes back (REQ-359)', async () => {
  const ui = await openLaunch(['sales', 'hr']);
  const { page } = ui;
  try {
    await until(async () => (await listed(page)).length === 2, 'the installer catalogs are listed');
    assert.deepEqual(await listed(page), ['hr', 'sales'], 'only the installer catalogs by default (must-exclude: main and finance are hidden)');
    const loadAll = page.getByRole('button', { name: LOAD_ALL, exact: true });
    assert.equal(await loadAll.count(), 1, 'a Load all catalogs button is shown');
    const [button, first] = await Promise.all([loadAll.boundingBox(), page.locator('button[title="hr"]').boundingBox()]);
    assert.ok(button.y + button.height <= first.y, 'Load all sits above the catalog list');
    await loadAll.click();
    await until(async () => (await listed(page)).length === 4, 'every catalog the person can see is listed after Load all');
    assert.deepEqual(await listed(page), ['finance', 'hr', 'main', 'sales']);
    await page.getByRole('button', { name: INSTALLER_ONLY, exact: true }).click();
    await until(async () => (await listed(page)).length === 2, 'Installer catalogs only goes back to the install list');
    assert.deepEqual(await listed(page), ['hr', 'sales']);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('with no installer catalog setting (an older install or none picked), every catalog is listed and there is no Load all button (must-keep)', async () => {
  for (const setting of [undefined, null, []]) {
    const ui = await openLaunch(setting);
    try {
      await until(async () => (await listed(ui.page)).length === 4, 'every catalog is listed when the install gave no list');
      assert.equal(await ui.page.getByRole('button', { name: LOAD_ALL, exact: true }).count(), 0);
      assert.equal(await ui.page.getByRole('button', { name: INSTALLER_ONLY, exact: true }).count(), 0);
    } finally {
      await ui.close();
    }
  }
});

test('the Discover launch page no longer offers "I don\'t have data" (REQ-360); the Start page choice "No data yet" stays', async () => {
  const ui = await openLaunch(['sales', 'hr']);
  try {
    assert.equal(await ui.page.getByRole('button', { name: NO_DATA }).count(), 0, 'no demo-table button on the launch page (must-exclude)');
    await ui.page.goBack();
    await ui.page.waitForFunction(() => window.location.hash === '#/start', null, { timeout: 20000 });
    await ui.page.locator('[data-start-choice="no-data"]').waitFor({ timeout: 20000 });
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
