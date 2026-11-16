import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, goToStep, openUi, until } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';
import { built } from './implementFixtures.js';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const measured = (high) => JSON.stringify({ status: 'measured', value_low: high / 2, value_high: high, currency: 'AED',
  text: `AED ${high.toLocaleString('en-US')} a year, measured from the orders table` });
const evidence = (...tables) => JSON.stringify({ tables: Object.fromEntries(tables.map((t) => [t, { columns: [] }])) });
const USE_CASES = [
  { id: 'N01-U01', name_with_technique: 'Predict churn', primary_table: 'main.s.orders', tables_involved: 'main.s.orders', value_estimate: measured(6000), data_evidence: evidence('main.s.orders'), inspire_score: '7.4' },
  { id: 'N01-U02', name_with_technique: 'Forecast weekly orders', primary_table: 'main.s.orders', tables_involved: 'main.s.orders', value_estimate: measured(9000), data_evidence: evidence('main.s.orders'), inspire_score: '8.1' },
];
const STATE = { ...REVIEW_STATE, useCases: USE_CASES, history: [built({ use_case_id: 'N01-U01' })] };

// REQ-344: the early Build button says which steps it keeps as defaults before it submits.
test('the early Build button names the steps it keeps as defaults (REQ-344)', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await goToStep(page, 'Data');
    const button = page.locator('[data-build-now]');
    await button.waitFor({ timeout: 15000 });
    const line = (await page.locator('[data-build-defaults]').innerText()).trim();
    assert.match(line, /^Uses the defaults for .+ and .+$/, line);
    assert.match(line, /First run/, 'the skipped First run step is named (must-exclude: a silent submit)');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

// REQ-345: the data check says what it reads and the seconds so far, and Next waits for it.
test('the data check names what it reads and the seconds so far, and Next waits for it (REQ-345)', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await goToStep(page, 'Data');
    await page.route('**/api/inspire/implement/readiness**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await route.continue();
    });
    await page.getByRole('button', { name: 'Next' }).click();
    const line = page.locator('[data-data-progress]');
    await line.waitFor({ timeout: 10000 });
    assert.match((await line.innerText()).trim(), /^Counting the rows the use case reads and checking its columns and filters, \d+ s so far$/);
    assert.equal(await page.getByRole('button', { name: /Checking the data/ }).isDisabled(), true, 'Next stays disabled while the check runs');
    await line.waitFor({ state: 'detached', timeout: 30000 });
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

// REQ-323: a queued build is still on the Build page after the tab reloads, while the history read has not shown its row yet.
test('a build queued from Build Next shows on the Build page after a reload, before the history shows it (REQ-323)', async () => {
  const log = { submits: 0 };
  const mount = (app) => {
    app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
    app.get('/api/showcase', (_req, res) => res.json({}));
    app.post('/api/inspire/implement/preflight', (_req, res) => res.json({ checks: {} }));
    app.post('/api/inspire/implement/submit', (req, res) => {
      log.submits += 1;
      res.json({ session_id: '42', use_case_id: req.body.spec.use_case_id, spec_version: 1, summary: {}, warnings: [] });
    });
    // The history read lags behind the submit: it never returns the new row here.
    app.get('/api/inspire/implement/history', (req, res, next) => (log.submits ? res.json({ latest: [], notebook_run: null, notebook_run_error: '' }) : next()));
  };
  const ui = await openUi('app', STATE, '', { mount });
  const { page } = ui;
  try {
    await page.goto(`${page.url().split('#')[0]}#/build/42/N01-U01`).catch(() => {});
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor({ timeout: 20000 });
    await page.locator('[data-next-step-row="N01-U02"]').getByRole('button', { name: 'Build Now', exact: true }).click();
    await until(() => log.submits === 1, 'one build submitted');
    await page.waitForFunction(() => window.location.hash.includes('/build/42/N01-U02'), null, { timeout: 20000 });
    await page.reload();
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor({ timeout: 20000 });
    await page.getByText('building now', { exact: false }).first().waitFor({ timeout: 15000 });
    assert.equal(await page.getByText('No MVP started yet', { exact: false }).count(), 0, 'the queued build is not reported as missing (must-fail: a reload drops the in-memory store)');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

// REQ-323: the early Build button on the wizard's step 2 shows the queued build on the Build page at once, with the history read still empty.
test('the early Build button shows its queued build on the Build page at once (REQ-323)', async () => {
  const log = { submits: 0 };
  const mount = (app) => {
    app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
    app.get('/api/showcase', (_req, res) => res.json({}));
    app.post('/api/inspire/implement/preflight', (_req, res) => res.json({ checks: {} }));
    app.post('/api/inspire/implement/submit', (req, res) => {
      log.submits += 1;
      res.json({ session_id: '42', use_case_id: req.body.spec.use_case_id, spec_version: 1, summary: {}, warnings: [] });
    });
    app.get('/api/inspire/implement/history', (_req, res) => res.json({ latest: [], notebook_run: null, notebook_run_error: '' }));
  };
  const ui = await openUi('wizard', ME, '', { mount });
  const { page } = ui;
  try {
    await goToStep(page, 'Data');
    await page.locator('[data-build-now]').click();
    await until(() => log.submits === 1, 'one build submitted');
    await page.getByText('building now', { exact: false }).first().waitFor({ timeout: 15000 });
    assert.equal(await page.getByText('No MVP started yet', { exact: false }).count(), 0, 'the queued build is shown at once (must-fail without noteBuildSubmitted on this path)');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
