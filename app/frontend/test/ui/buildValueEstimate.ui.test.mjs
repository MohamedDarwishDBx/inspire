import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, until } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';
import { built } from './implementFixtures.js';

// REQ-078 wiring: the Build page must request the value estimates route and show its line on each card. Before the fix the page
// never asked, so an unmeasured card read "Value not measured yet" and a measured card had no route answer to respect.
test.after(closeBrowser);

const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const measured = (high) => JSON.stringify({ status: 'measured', value_low: high / 2, value_high: high, currency: 'AED',
  text: `AED ${high.toLocaleString('en-US')} a year, measured from the orders table` });
const evidence = (...tables) => JSON.stringify({ tables: Object.fromEntries(tables.map((t) => [t, { columns: [] }])) });
const USE_CASES = [
  { id: 'N01-U01', name_with_technique: 'Predict churn', primary_table: 'main.s.orders', tables_involved: 'main.s.orders', value_estimate: measured(6000), data_evidence: evidence('main.s.orders') },
  { id: 'N01-U02', name_with_technique: 'Forecast weekly orders', primary_table: 'main.s.orders', tables_involved: 'main.s.orders', value_estimate: measured(9000), data_evidence: evidence('main.s.orders') },
  { id: 'N01-U03', name_with_technique: 'Flag late shipments', primary_table: 'main.s.orders', tables_involved: 'main.s.orders',
    value_estimate: JSON.stringify({ status: 'not measured yet', text: 'Value not measured yet: measure late shipments.' }), data_evidence: evidence('main.s.orders') },
];
const STATE = { ...REVIEW_STATE, useCases: USE_CASES, history: [built({ use_case_id: 'N01-U01' })] };
// The route answer: N01-U02 is measured, so its route entry is a set_rule that must not replace its figure; N01-U03 has no money rule.
const ESTIMATES = { runs: {}, totals: { estimated: {} }, use_cases: { 'N01-U01': null, 'N01-U02': { status: 'set_rule' }, 'N01-U03': { status: 'set_rule' } }, truncated: false, cap: 20 };

test('the Build page requests the value estimates route and shows its line on an unmeasured card, and keeps a measured figure', async () => {
  const requested = [];
  const mount = (app) => {
    app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
    app.get('/api/showcase', (_req, res) => res.json({}));
    app.get('/api/inspire/value/estimates', (req, res) => { requested.push(req.query); res.json(ESTIMATES); });
  };
  const ui = await openUi('app', STATE, '', { mount });
  const { page } = ui;
  try {
    await page.goto(`${page.url().split('#')[0]}#/build/42/N01-U01`).catch(() => {});
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor({ timeout: 20000 });
    await until(() => requested.length > 0, 'the Build page asks for the value estimates');
    assert.equal(requested[0].session_id, '42', 'the estimates are read for this session');
    const unmeasured = page.locator('[data-value-estimate="set-rule"]');
    await unmeasured.first().waitFor({ timeout: 20000 });
    assert.ok(await unmeasured.count() >= 1, 'an unmeasured card shows the route line');
    const body = await page.locator('body').innerText();
    assert.match(body, /Set a money rule to see the value at stake\./);
    assert.doesNotMatch(body, /Value not measured yet: measure late shipments/, 'the route line replaces the Discover fallback on that card');
    assert.match(body, /AED 9,000 a year/, 'the measured figure stays on its card even though the route answered set a rule');
  } finally {
    await ui.close();
  }
});
