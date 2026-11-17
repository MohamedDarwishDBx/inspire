// REQ-389: the Discover row filters carry into the MVP wizard's Data step as removable chips, with a Whole data choice. The build reads
// exactly the scope the person chose (the job's 17_table_scope), so a whole-data build is reachable from that step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, goToStep, openUi, startMvp, toSummary, until } from './uiSupport.mjs';

test.after(closeBrowser);

const TABLE = 'main.s.orders';
const DISCOVER_SCOPE = JSON.stringify({
  [TABLE]: {
    columns: ['order_id', 'paymentMethod', 'status'],
    rows: [{ column: 'paymentMethod', op: '=', values: ['visa'] }, { column: 'status', op: '=', values: ['gold'] }],
  },
});
const SESSION = { business_name: 'Acme', discovery_type: 'Deep', catalogs: 'main', schemas_str: 's', tables_str: TABLE, generation_path: '/tmp/out', inspire_database_name: 'main.inspire', table_scope: DISCOVER_SCOPE };

const chips = (page) => page.locator(`[data-scope-chip="${TABLE}"]`);
const chipTexts = async (page) => (await chips(page).allInnerTexts()).map((t) => t.trim());
const submittedSpec = (made) => {
  const inserts = made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'));
  assert.equal(inserts.length, 1, 'one version was written');
  return JSON.parse(inserts[0].parameters.find((p) => p.name === 'spec').value);
};

async function openDataStep() {
  const ui = await openUi('wizard&discovery=Deep', { session: SESSION });
  await goToStep(ui.page, 'Data');
  await ui.page.locator('[data-discover-filters]').waitFor({ timeout: 15000 });
  return ui;
}

test('the Discover row filters show on the Data step as chips, and removing one leaves the rest for the build (REQ-389, must-fail before)', async () => {
  const ui = await openDataStep();
  const { page, made, pageErrors } = ui;
  try {
    assert.deepEqual(await chipTexts(page), ['paymentMethod is visa on main.s.orders', 'status is gold on main.s.orders']);
    await page.getByRole('button', { name: 'Remove row filter paymentMethod is visa on main.s.orders', exact: true }).click();
    await page.waitForFunction((t) => document.querySelectorAll(`[data-scope-chip="${t}"]`).length === 1, TABLE);
    assert.deepEqual(await chipTexts(page), ['status is gold on main.s.orders'], 'only the removed chip goes');
    assert.match(await page.locator('[data-table-scope-notes]').innerText(), /main\.s\.orders: 3 columns, rows where status is gold/);

    await toSummary(page);
    await startMvp(page);
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    assert.equal(made.jobs.length, 1);
    assert.deepEqual(submittedSpec(made).data.table_scope[TABLE].rows, [{ column: 'status', op: '=', values: ['gold'] }], 'the spec keeps the chosen rows');
    const sent = JSON.parse(made.jobs[0].params['17_table_scope']);
    assert.deepEqual(sent[TABLE].rows, [{ column: 'status', op: '=', values: ['gold'] }], 'the build reads only the filter that stayed');
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Whole data takes every Discover row filter off, so the build reads every row; Use the Discover filters again brings them back (REQ-389, must-fail before)', async () => {
  const ui = await openDataStep();
  const { page, made, pageErrors } = ui;
  try {
    await page.locator('[data-whole-data]').click();
    await page.waitForFunction((t) => document.querySelectorAll(`[data-scope-chip="${t}"]`).length === 0, TABLE);
    assert.equal(await page.locator('[data-whole-data]').getAttribute('aria-pressed'), 'true');
    assert.match(await page.locator('[data-whole-data-note]').innerText(), /Whole data: the build reads every row of each table/);
    assert.match(await page.locator('[data-table-scope-notes]').innerText(), /main\.s\.orders: 3 columns, all rows/);

    await toSummary(page);
    await startMvp(page);
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    assert.equal(made.jobs.length, 1);
    assert.deepEqual(submittedSpec(made).data.table_scope, { [TABLE]: { columns: ['order_id', 'paymentMethod', 'status'], rows: [] } },
      'the columns Discover kept stay, with no row filter');
    assert.deepEqual(JSON.parse(made.jobs[0].params['17_table_scope'])[TABLE].rows, [], 'the job reads every row of the table');
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the Discover filters come back on the Data step after Whole data, and a build with them reads them again (REQ-389, must-keep)', async () => {
  const ui = await openDataStep();
  const { page, made } = ui;
  try {
    await page.locator('[data-whole-data]').click();
    await page.locator('[data-discover-filters-restore]').click();
    await page.waitForFunction((t) => document.querySelectorAll(`[data-scope-chip="${t}"]`).length === 2, TABLE);
    assert.deepEqual(await chipTexts(page), ['paymentMethod is visa on main.s.orders', 'status is gold on main.s.orders']);
    await toSummary(page);
    await startMvp(page);
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    assert.equal(made.jobs.length, 1);
    assert.equal(JSON.parse(made.jobs[0].params['17_table_scope'])[TABLE].rows.length, 2, 'both Discover filters are read');
  } finally {
    await ui.close();
  }
});

// REQ-389 follow-up (risk 2): the wizard's Data groups read names the Table Scope the Data step shows, so a removed chip is no longer read.
test('the Data groups read names the Table Scope the Data step shows, so a removed filter is no longer read (REQ-389, must-fail before)', async () => {
  const profileScopes = [];
  const init = async (page) => {
    await page.route('**/api/grouping/profile', (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      profileScopes.push(body.table_scope ?? null);
      route.continue();
    });
  };
  const ui = await openUi('wizard&discovery=Deep', { session: SESSION }, '', { init });
  const { page } = ui;
  try {
    await goToStep(page, 'Data');
    await page.locator('[data-discover-filters]').waitFor({ timeout: 15000 });
    assert.equal(profileScopes.at(-1), null, 'with no choice the profile names no scope, so the Discover run scope is read');
    await page.getByRole('button', { name: 'Remove row filter paymentMethod is visa on main.s.orders', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-scope-chip]').length === 1);
    await until(() => profileScopes.at(-1) != null, 'the profile was asked again for the chosen scope');
    const sent = JSON.parse(profileScopes.at(-1));
    assert.deepEqual(sent[TABLE].rows, [{ column: 'status', op: '=', values: ['gold'] }], 'the profile reads the filter that stayed, not the one removed');
    await page.getByRole('button', { name: 'Whole data', exact: true }).click();
    await until(() => profileScopes.at(-1) != null && JSON.parse(profileScopes.at(-1))[TABLE].rows.length === 0, 'whole data is asked with no row filter');
    assert.deepEqual(JSON.parse(profileScopes.at(-1))[TABLE].columns, ['order_id', 'paymentMethod', 'status'], 'the columns Discover kept stay');
  } finally {
    await ui.close();
  }
});
