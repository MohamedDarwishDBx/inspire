// REQ-180: on the Build wizard's Data step, a picked table whose catalog is gone is named with its own name, and a metric view
// is a neutral note. Neither shows Try again, because a retry cannot change either pick.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HARNESS_USE_CASE, OWNER } from './implementFixtures.js';
import { closeBrowser, goToStep, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const PICKED = 'amr_ali.sales.orders';
const VIEW = 'adb_fe_uae_01.default.order_revenue_metrics';
const MISSING_CATALOG = '[TABLE_OR_VIEW_NOT_FOUND] The table or view `amr_ali`.`information_schema`.`columns` cannot be found. '
  + 'Verify the spelling and correctness of the schema and catalog. SQLSTATE: 42P01; line 1 pos 24';
const ME = { userName: OWNER, displayName: 'Owner' };

test('a picked table in a catalog that is gone is named on the Data step, with no Try again (REQ-180)', async () => {
  const ui = await openUi('wizard', { me: ME, history: [], useCase: { ...HARNESS_USE_CASE, primary_table: PICKED, tables_involved: PICKED },
    sqlErrors: { 'information_schema.columns': MISSING_CATALOG } });
  const { page } = ui;
  try {
    await goToStep(page, 'Data');
    const alert = page.getByRole('alert').filter({ hasText: `Table ${PICKED} does not exist` });
    await alert.waitFor();
    assert.equal(await alert.getByRole('button', { name: 'Try again' }).count(), 0, 'a missing table is permanent: no Try again');
    assert.equal(await page.getByText('information_schema', { exact: false }).count(), 0, 'the view is not named to the person');
    assert.deepEqual(ui.pageErrors.filter((e) => !/Failed to load resource/.test(e)), [], 'no page exception');
  } finally {
    await ui.close();
  }
});

test('a metric view picked on the Data step is a neutral note, not an error with Try again (REQ-180)', async () => {
  const ui = await openUi('wizard', { me: ME, history: [], useCase: { ...HARNESS_USE_CASE, primary_table: PICKED, tables_involved: `${PICKED}, ${VIEW}` },
    metricViews: [VIEW] });
  const { page } = ui;
  try {
    await goToStep(page, 'Data');
    const note = page.locator('[data-metric-view-note]').filter({ hasText: `${VIEW} is a metric view` });
    await note.waitFor();
    assert.equal(await note.getAttribute('role'), 'note');
    assert.equal(await page.getByRole('alert').filter({ hasText: 'is a metric view' }).count(), 0, 'not a red error');
    assert.equal(await page.locator('[role="alert"]').filter({ hasText: 'is a metric view' }).getByRole('button', { name: 'Try again' }).count(), 0);
    assert.deepEqual(ui.pageErrors.filter((e) => !/Failed to load resource/.test(e)), [], 'no page exception');
  } finally {
    await ui.close();
  }
});
