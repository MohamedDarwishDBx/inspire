import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

// REQ-234 / REQ-115: the App shows the release a person installed, read from /api/defaults.agentVersion.
const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };

async function openWith(defaults) {
  const mount = (app) => {
    app.get('/api/defaults', (_req, res) => res.json(defaults));
    app.get('/api/showcase', (_req, res) => res.json({}));
  };
  return openUi('app', {}, '', { mount });
}

test('the home footer and the header on Start show the release tag from /api/defaults.agentVersion', async () => {
  const ui = await openWith({ ...DEFAULTS, agentVersion: 'v1.5.3-rc.2' });
  const { page } = ui;
  try {
    await page.getByRole('button', { name: 'Get Started', exact: true }).first().waitFor({ timeout: 20000 });
    const about = page.getByRole('contentinfo', { name: 'About Inspire' });
    assert.equal(await about.locator('[data-release-tag]').innerText(), 'v1.5.3-rc.2', 'the home footer shows the tag');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
    await page.locator('header [data-release-tag]').waitFor({ timeout: 20000 });
    assert.equal(await page.locator('header [data-release-tag]').innerText(), 'v1.5.3-rc.2', 'the header on Start shows the tag');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('no release tag element renders when /api/defaults has no agentVersion', async () => {
  const ui = await openWith({ ...DEFAULTS });
  const { page } = ui;
  try {
    await page.getByRole('button', { name: 'Get Started', exact: true }).first().waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-release-tag]').count(), 0, 'no tag element on home without an API value');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
    await page.getByRole('navigation').waitFor();
    assert.equal(await page.locator('header [data-release-tag]').count(), 0, 'no tag element in the header without an API value');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
