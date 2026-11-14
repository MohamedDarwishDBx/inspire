import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

// A module request that a network change aborts. Playwright has no ERR_NETWORK_CHANGED code, so this aborts at the network level
// ('connectionaborted'). The app's boot guard reacts to the failed module the same way for either code.
const MODULE = '**/src/lib/normalizeDatabricksHost.js*';
const GUARD_TEXT = 'Inspire could not finish loading because the network connection changed. Reload to try again.';
// The module the test aborts is part of the app's boot graph, so the app never mounts without the guard.
const isAbortedByTest = (text) => text.includes('net::ERR_CONNECTION_ABORTED');
// The same boot answers as the boot-deadline suite: a set-up workspace, so the first screen is the landing page with Get Started.
const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const mount = (app) => {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
  app.get('/api/tick/:n', (_req, res) => res.end('ok'));
};

test('one module request aborted on first load: the page reloads once by itself and the app renders', async () => {
  let aborted = 0;
  const init = async (page) => {
    await page.route(MODULE, (route) => {
      aborted += 1;
      if (aborted === 1) return route.abort('connectionaborted');
      return route.continue();
    });
  };
  const ui = await openUi('app', {}, '', { mount, init });
  try {
    await ui.page.getByRole('button', { name: 'Get Started' }).first().waitFor({ timeout: 30000 });
    assert.equal(aborted >= 2, true, 'the module was requested again after the abort');
    assert.equal(await ui.page.getByText(GUARD_TEXT).count(), 0, 'the message never shows when one reload recovers the page');
    assert.deepEqual(ui.pageErrors.filter((e) => !isAbortedByTest(e)), [], 'no page error beyond the aborted request');
  } finally {
    await ui.close();
  }
});

test('every load aborts the module: the plain message and Reload show, with exactly one automatic reload and no loop', async () => {
  let loads = 0;
  const init = async (page) => {
    page.on('request', (r) => { if (r.isNavigationRequest() && r.url().includes('implement.html')) loads += 1; });
    await page.route(MODULE, (route) => route.abort('connectionaborted'));
  };
  const ui = await openUi('app', {}, '', { mount, init });
  try {
    await ui.page.getByText(GUARD_TEXT).waitFor({ timeout: 30000 });
    assert.equal(await ui.page.getByRole('button', { name: 'Reload', exact: true }).count(), 1, 'the Reload button shows');
    assert.equal(loads, 2, 'the first load and one automatic reload, then the message');
    await new Promise((r) => setTimeout(r, 3000));
    assert.equal(loads, 2, 'the message stays: the page does not reload again by itself');
    // Reload is a user action: it loads the page again, and the guard does not reload a second time inside the window.
    await ui.page.getByRole('button', { name: 'Reload', exact: true }).click();
    await ui.page.getByText(GUARD_TEXT).waitFor({ timeout: 30000 });
    await new Promise((r) => setTimeout(r, 3000));
    assert.equal(loads, 3, 'Reload loads the page once more and nothing repeats after it');
    assert.deepEqual(ui.pageErrors.filter((e) => !isAbortedByTest(e)), [], 'no page error beyond the aborted requests');
  } finally {
    await ui.close();
  }
});

test('a module request that makes no progress for 8 s on first load: the guard reloads once and the app renders', async () => {
  let requests = 0;
  let loads = 0;
  const init = async (page) => {
    page.on('request', (r) => { if (r.isNavigationRequest() && r.url().includes('implement.html')) loads += 1; });
    // The first request hangs for 25 s with no other resource finishing, so the guard reloads at its quiet bound. The reload is served normally.
    await page.route(MODULE, async (route) => {
      requests += 1;
      if (requests === 1) { await new Promise((r) => setTimeout(r, 25000)); return route.abort('connectionaborted'); }
      return route.continue();
    });
  };
  const ui = await openUi('app', {}, '', { mount, init });
  try {
    await ui.page.getByRole('button', { name: 'Get Started' }).first().waitFor({ timeout: 40000 });
    assert.equal(loads, 2, 'one automatic reload for the stalled boot');
    assert.equal(await ui.page.getByText(GUARD_TEXT).count(), 0, 'the reload recovers the page, so no message');
  } finally {
    await ui.close();
  }
});

test('a slow boot that keeps finishing resources every 2 s is not reloaded (must-exclude): the app renders on its first load', async () => {
  let loads = 0;
  let held = true;
  const init = async (page) => {
    page.on('request', (r) => { if (r.isNavigationRequest() && r.url().includes('implement.html')) loads += 1; });
    // A fetch every 2 s for 25 s: each one finishes, so the boot shows progress although the first module is slow.
    await page.addInitScript(() => {
      const until = Date.now() + 25000;
      let n = 0;
      const tick = setInterval(() => {
        if (Date.now() > until) { clearInterval(tick); return; }
        n += 1;
        fetch(`/api/tick/${n}`, { cache: 'no-store' }).catch(() => null);
      }, 2000);
    });
    await page.route(MODULE, async (route) => {
      if (held) { held = false; await new Promise((r) => setTimeout(r, 25000)); }
      return route.continue();
    });
  };
  const ui = await openUi('app', {}, '', { mount, init });
  try {
    await ui.page.getByRole('button', { name: 'Get Started' }).first().waitFor({ timeout: 40000 });
    assert.equal(loads, 1, 'the slow boot made progress every 2 s, so the guard never reloaded it');
    assert.equal(await ui.page.getByText(GUARD_TEXT).count(), 0, 'no message on a boot that finished');
  } finally {
    await ui.close();
  }
});
