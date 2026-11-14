import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };

test('a boot read of /api/defaults that never answers shows the load error with Try again within the bound, and Try again recovers once it answers', async () => {
  // Every read is held until the test starts answering. The app runs under StrictMode, so the boot effect asks twice.
  let answering = false;
  let asked = 0;
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const mount = (app) => {
    app.get('/api/defaults', async (_req, res) => {
      asked += 1;
      if (!answering) await held;
      res.json(DEFAULTS);
    });
    app.get('/api/showcase', (_req, res) => res.json({}));
  };
  const ui = await openUi('app', {}, '', { mount });
  try {
    const started = Date.now();
    await ui.page.getByText('did not answer within 20 seconds').waitFor({ timeout: 30000 });
    const shownIn = Date.now() - started;
    assert.ok(shownIn >= 15000 && shownIn < 27000, `the load error showed after ${shownIn} ms, not at the 20 s bound`);
    assert.equal(await ui.page.getByText('Connecting to workspace...').count(), 0, 'the spinner gives way to the error');
    answering = true;
    await ui.page.getByRole('button', { name: 'Try again', exact: true }).click();
    await ui.page.getByRole('button', { name: 'Get Started' }).first().waitFor({ timeout: 20000 });
    assert.ok(asked >= 2, 'Try again asked /api/defaults again');
    // The bootstrap logs the timed-out read on purpose; no other page error may appear.
    assert.deepEqual(ui.pageErrors.filter((e) => !e.includes('[bootstrap] error: Error: Inspire did not answer')), []);
  } finally {
    release();
    await ui.close();
  }
});
