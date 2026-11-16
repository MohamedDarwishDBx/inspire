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
