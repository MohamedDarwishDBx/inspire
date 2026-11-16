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

test('a warehouse detect that never answers leaves the warehouse blank, as a failed detect does, and boot still reaches the app', async () => {
  let answering = false;
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const logs = [];
  const mount = (app) => {
    app.get('/api/defaults', (_req, res) => res.json({ ...DEFAULTS, warehouseId: '', envSkipsSetupWizard: true }));
    app.get('/api/warehouses', async (_req, res) => {
      if (!answering) await held;
      res.json({ warehouses: [{ id: 'wh9', state: 'RUNNING', enable_serverless_compute: true }] });
    });
    app.get('/api/showcase', (_req, res) => res.json({}));
  };
  const ui = await openUi('app', {}, '', { mount, init: async (page) => { page.on('console', (m) => logs.push(m.text())); } });
  try {
    await ui.page.getByRole('button', { name: 'Get Started' }).first().waitFor({ timeout: 30000 });
    const ready = logs.find((l) => l.startsWith('[bootstrap] ready:'));
    assert.ok(ready, 'boot finished its read');
    assert.match(ready, /warehouse: MISSING/, 'the warehouse stays blank, the same as a failed detect');
    assert.deepEqual(ui.pageErrors.filter((e) => !e.includes('[bootstrap] error: Error: Inspire did not answer')), []);
  } finally {
    answering = true;
    release();
    await ui.close();
  }
});

test('the setup page says when its own boot read never answers, and Try again asks again', async () => {
  let answering = false;
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const mount = (app) => {
    // The App never reads /api/health, so the first read of it is the setup page's own. The hold is released by Try again.
    app.get('/api/defaults', (_req, res) => res.json({ ...DEFAULTS, envSkipsSetupWizard: false, warehouseId: '', inspireDatabase: '', databricksHost: '' }));
    app.get('/api/health', async (_req, res) => {
      if (!answering) await held;
      res.json({ isDatabricksApp: false });
    });
    app.get('/api/showcase', (_req, res) => res.json({}));
  };
  const ui = await openUi('app', {}, '', { mount });
  try {
    await ui.page.locator('[data-setup-error]').getByText('did not answer within 20 seconds').waitFor({ timeout: 30000 });
    answering = true;
    await ui.page.locator('[data-setup-error]').getByRole('button', { name: 'Try again', exact: true }).click();
    await ui.page.locator('[data-setup-error]').waitFor({ state: 'detached', timeout: 20000 });
    assert.deepEqual(ui.pageErrors.filter((e) => !e.includes('did not answer within 20 seconds')), []);
  } finally {
    release();
    await ui.close();
  }
});

// Under StrictMode the App's boot effect runs twice, so its first two reads of a route are the App's. Later reads come from
// the setup page, which is the read the test holds.
const holdFromThird = () => {
  const state = { calls: 0, answering: false, release: null };
  state.held = new Promise((resolve) => { state.release = resolve; });
  state.gate = async () => { state.calls += 1; if (state.calls > 2 && !state.answering) await state.held; };
  return state;
};
const SETUP_DEFAULTS = { envSkipsSetupWizard: false, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1', inspireDatabase: 'main.inspire', notebookPath: '' };

test('the setup page\'s own /api/defaults read that never answers shows its alert with Try again, and Try again runs it again', async () => {
  const gate = holdFromThird();
  const mount = (app) => {
    app.get('/api/defaults', async (_req, res) => { await gate.gate(); res.json({ ...SETUP_DEFAULTS, isDatabricksApp: false, warehouseId: '', inspireDatabase: '' }); });
    app.get('/api/health', (_req, res) => res.json({ isDatabricksApp: false }));
    app.get('/api/warehouses', (_req, res) => res.json({ warehouses: [] }));
    app.get('/api/notebook', (_req, res) => res.json({ path: '' }));
    app.get('/api/showcase', (_req, res) => res.json({}));
  };
  const ui = await openUi('app', {}, '', { mount });
  try {
    await ui.page.locator('[data-setup-error]').getByText('did not answer within 20 seconds').waitFor({ timeout: 30000 });
    gate.answering = true;
    await ui.page.locator('[data-setup-error]').getByRole('button', { name: 'Try again', exact: true }).click();
    await ui.page.locator('[data-setup-error]').waitFor({ state: 'detached', timeout: 20000 });
    assert.deepEqual(ui.pageErrors.filter((e) => !e.includes('did not answer within 20 seconds')), []);
  } finally {
    gate.release();
    await ui.close();
  }
});

test('the setup page\'s warehouse read that never answers shows its alert with Try again, and the warehouse list loads once it answers', async () => {
  const gate = holdFromThird();
  const mount = (app) => {
    app.get('/api/defaults', (_req, res) => res.json({ ...SETUP_DEFAULTS, warehouseId: '', inspireDatabase: '', envSkipsSetupWizard: false }));
    app.get('/api/health', (_req, res) => res.json({ isDatabricksApp: true }));
    app.get('/api/notebook', (_req, res) => res.json({ path: '' }));
    app.get('/api/warehouses', async (_req, res) => {
      await gate.gate();
      res.json({ warehouses: [{ id: 'wh9', name: 'Serverless', state: 'RUNNING', enable_serverless_compute: true }] });
    });
    app.get('/api/showcase', (_req, res) => res.json({}));
  };
  const ui = await openUi('app', {}, '', { mount });
  try {
    await ui.page.getByText('Connect to your Databricks workspace').waitFor({ timeout: 20000 });
    for (let i = 0; i < 5 && !(await ui.page.getByText('Loading warehouses...').count()); i += 1) {
      await ui.page.getByRole('button', { name: 'Continue', exact: true }).click();
      await ui.page.waitForLoadState('networkidle');
    }
    await ui.page.locator('[data-setup-error]').getByText('did not answer within 20 seconds').waitFor({ timeout: 30000 });
    gate.answering = true;
    await ui.page.locator('[data-setup-error]').getByRole('button', { name: 'Try again', exact: true }).click();
    await ui.page.getByText('Serverless', { exact: false }).first().waitFor({ timeout: 20000 });
    assert.deepEqual(ui.pageErrors.filter((e) => !e.includes('did not answer within 20 seconds')), []);
  } finally {
    gate.release();
    await ui.close();
  }
});

test('the setup page\'s notebook read that never answers stops the auto-complete with its alert, and Try again completes setup', async () => {
  const gate = holdFromThird();
  const mount = (app) => {
    // Host, warehouse and database are all set, so the setup page auto-completes once the notebook read answers.
    app.get('/api/defaults', (_req, res) => res.json({ ...SETUP_DEFAULTS, envSkipsSetupWizard: false, autoSetup: false }));
    app.get('/api/health', (_req, res) => res.json({ isDatabricksApp: true }));
    app.post('/api/setup/create-database', (_req, res) => res.json({ ok: true }));
    app.get('/api/notebook', async (_req, res) => { await gate.gate(); res.json({ path: '' }); });
    app.get('/api/showcase', (_req, res) => res.json({}));
  };
  const ui = await openUi('app', {}, '', { mount });
  try {
    await ui.page.locator('[data-setup-error]').getByText('did not answer within 20 seconds').waitFor({ timeout: 30000 });
    gate.answering = true;
    await ui.page.locator('[data-setup-error]').getByRole('button', { name: 'Try again', exact: true }).click();
    await ui.page.getByRole('button', { name: 'Get Started' }).first().waitFor({ timeout: 30000 });
    assert.deepEqual(ui.pageErrors.filter((e) => !e.includes('did not answer within 20 seconds')), []);
  } finally {
    gate.release();
    await ui.close();
  }
});
