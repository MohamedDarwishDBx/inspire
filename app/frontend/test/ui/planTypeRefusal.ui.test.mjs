// REQ-180: the Build wizard's plan refusals for a table whose type cannot be read are one plain named line, never raw JSON. A
// refusal of the pick (metric view, not usable) has no Try again; a type check the workspace could not answer twice has Try again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HARNESS_USE_CASE, OWNER } from './implementFixtures.js';
import { closeBrowser, goToStep, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const PICKED = 'main.s.orders';
const ME = { userName: OWNER, displayName: 'Owner' };
const BUSY = '[HTTP 503] Service Unavailable';
const useCase = { ...HARNESS_USE_CASE, primary_table: PICKED, tables_involved: PICKED };

async function planAlert(ui, text) {
  const { page } = ui;
  await goToStep(page, 'Review & build');
  const alert = page.getByRole('alert').filter({ hasText: text });
  await alert.waitFor({ timeout: 20000 });
  return alert;
}

test('a metric view refused by the plan is one plain line with no Try again and no raw JSON (REQ-180)', async () => {
  const ui = await openUi('wizard', { me: ME, history: [], useCase, metricViews: [PICKED] });
  try {
    const alert = await planAlert(ui, `${PICKED} is a metric view`);
    const text = (await alert.innerText()).trim();
    assert.equal(text.split('\n').filter((line) => /is a metric view/.test(line)).length, 1, `one named line: ${text}`);
    assert.doesNotMatch(text, /[{}]|"error"/, 'no raw JSON');
    assert.equal(await alert.getByRole('button', { name: 'Try again' }).count(), 0, 'a metric view stays wrong until the pick changes');
    assert.deepEqual(ui.pageErrors.filter((e) => !/Failed to load resource/.test(e)), [], 'no page exception');
  } finally {
    await ui.close();
  }
});

test('a type check the workspace could not answer twice is one plain line with Try again (REQ-180)', async () => {
  const statements = { 'table_type FROM': () => { throw new Error(`SQL failed (503): ${BUSY}`); } };
  const ui = await openUi('wizard', { me: ME, history: [], useCase, statements });
  try {
    const alert = await planAlert(ui, 'Inspire could not check the type of main.s.orders right now');
    const text = (await alert.innerText()).trim();
    assert.equal(text.split('\n').filter((line) => /could not check the type/.test(line)).length, 1, `one named line: ${text}`);
    assert.doesNotMatch(text, /[{}]|"error"|is not usable/, 'no raw JSON and not shown as a verdict on the table');
    assert.equal(await alert.getByRole('button', { name: 'Try again' }).count(), 1, 'a busy check can be run again');
    assert.deepEqual(ui.pageErrors.filter((e) => !/Failed to load resource/.test(e)), [], 'no page exception');
  } finally {
    await ui.close();
  }
});
