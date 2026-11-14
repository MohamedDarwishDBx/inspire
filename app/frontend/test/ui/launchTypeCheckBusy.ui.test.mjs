// REQ-180: the Launch page's Unity Catalog table picker lists a table whose type check the workspace could not answer twice as busy,
// not as not usable, and Try again lists its schema again (the same line and button as Data Filters).
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const CUSTOMERS = 'adb_fe_uae_01.demo_telco.customers';
const PERSON = 'harness.person@example.com';
const BUSY = "Inspire could not check this table's type right now. Try again.";

test('a Launch table whose type check is busy is listed with Try again, not disabled as not usable, and Try again lists it once it can be checked (REQ-180)', async () => {
  const ui = await openUi('launch', { catalogs: ['adb_fe_uae_01'], schemas: { adb_fe_uae_01: ['demo_telco'] },
    tables: { 'adb_fe_uae_01.demo_telco': ['customers'] }, forwardedEmail: PERSON, busyTables: { [CUSTOMERS]: BUSY } });
  const { page, made, pageErrors } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('button[title="adb_fe_uae_01"]').click();
    await page.locator('button[title="demo_telco"]').click();
    await idle(page);
    const busy = page.locator(`[data-type-check-busy="${CUSTOMERS}"]`);
    await busy.waitFor({ timeout: 15000 });
    assert.match(await busy.innerText(), /Inspire could not check this table's type right now\./);
    assert.equal(await busy.getByRole('button', { name: 'Try again', exact: true }).count(), 1, 'Try again is offered');
    assert.equal(await page.locator('button[title="customers"]').count(), 0, 'a busy table cannot be picked while its check is busy');
    assert.equal(await page.locator('[data-unusable-reason]', { hasText: 'could not read' }).count(), 0, 'not shown as not usable');
    made.state.busyTables = {};
    await busy.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.locator('button[title="customers"]').waitFor({ timeout: 15000 });
    assert.equal(await page.locator(`[data-type-check-busy="${CUSTOMERS}"]`).count(), 0, 'the busy row is gone once the table is listed');
    assert.equal(await page.locator('button[title="customers"]').isDisabled(), false, 'the table can be picked');
    assert.deepEqual(pageErrors.filter((e) => !/Failed to load resource/.test(e)), [], 'no page exception');
  } finally {
    await ui.close();
  }
});

// REQ-180 (deselect race): a Try again answer that arrives after its schema was deselected is dropped. The schemas are listed again on a
// selection change, so the late answer must not add the table back to the picker.
test('a Try again that answers after its schema was deselected is dropped, not listed (REQ-180)', async () => {
  const ui = await openUi('launch', { catalogs: ['adb_fe_uae_01'], schemas: { adb_fe_uae_01: ['demo_telco'] },
    tables: { 'adb_fe_uae_01.demo_telco': ['customers'] }, forwardedEmail: PERSON, busyTables: { [CUSTOMERS]: BUSY } });
  const { page, made, pageErrors } = ui;
  let release = () => {};
  const held = new Promise((done) => { release = done; });
  let armed = false;
  let caught = () => {};
  const reached = new Promise((done) => { caught = done; });
  await page.route((url) => url.pathname === '/api/tables/adb_fe_uae_01/demo_telco', async (route) => {
    if (!armed) return route.continue();
    armed = false;
    caught();
    await held;
    return route.continue();
  });
  try {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('button[title="adb_fe_uae_01"]').click();
    await page.locator('button[title="demo_telco"]').click();
    await idle(page);
    const busy = page.locator(`[data-type-check-busy="${CUSTOMERS}"]`);
    await busy.waitFor({ timeout: 15000 });
    made.state.busyTables = {};
    armed = true;
    await busy.getByRole('button', { name: 'Try again', exact: true }).click();
    await reached;
    // idle() would wait for the held request, so the deselect is followed by a short wait instead.
    await page.locator('button[title="demo_telco"]').click();
    await page.waitForTimeout(500);
    release();
    await page.waitForTimeout(1500);
    assert.equal(await page.locator('button[title="customers"]').count(), 0, 'the late answer for a deselected schema is not listed');
    assert.equal(await page.locator(`[data-type-check-busy="${CUSTOMERS}"]`).count(), 0);
    assert.deepEqual(pageErrors.filter((e) => !/Failed to load resource/.test(e)), [], 'no page exception');
  } finally {
    release();
    await ui.close();
  }
});
