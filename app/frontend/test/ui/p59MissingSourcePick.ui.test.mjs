// REQ-240: a blocked Start MVP preview names the missing source table and offers the Data step's picker; a pick sends the preview again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, goToStep, idle, onStep, openUi, profileAt } from './uiSupport.mjs';
import { GROUPING_INSTRUCTION, GROUPING_PROFILE, HARNESS_USE_CASE, OWNER } from './implementFixtures.js';

test.after(closeBrowser);

const gone = (table) => `[TABLE_OR_VIEW_NOT_FOUND] The table or view ${table} cannot be found. Verify the spelling. SQLSTATE: 42P01`;
const PRIMARY = 'main.s.orders';
const sized = (page) => page.setViewportSize({ width: 1280, height: 900 });
// The picker's similar-table search: one readable table with the same columns that is not already a source.
const mount = (app) => {
  // The copy lookup (part=copy) finds nothing, the wider search finds the readable table once.
  app.post('/api/inspire/implement/swaps', (req, res) => {
    const copy = req.query?.part === 'copy';
    res.json({ table: req.body?.table, swaps: copy ? [] : [{ table: 'main.s.orders_v2', matched: 4, total: 4 }], unusable: [], busy: [] });
  });
};

test('a blocked preview offers Choose a replacement table, the Data step picker opens, and a pick runs the preview again', async () => {
  const ui = await openUi('wizard', {
    me: { userName: OWNER, displayName: 'Owner' },
    useCase: { ...HARNESS_USE_CASE, genie_instruction: GROUPING_INSTRUCTION },
    probeErrors: { '`main`.`s`.`orders`': gone('`main`.`s`.`orders`') },
  }, '', { mount, init: async (page) => { await sized(page); await profileAt([], GROUPING_PROFILE)(page); } });
  const { page, made } = ui;
  try {
    await goToStep(page, 'Data');
    await goToStep(page, 'Review & build');
    await idle(page);
    const pick = page.locator('[data-pick-replacement]');
    await pick.waitFor({ timeout: 20000 });
    assert.equal(await pick.textContent(), 'Choose a replacement table');
    assert.equal(await page.getByRole('button', { name: 'All Good, Build it Now', exact: true }).isDisabled(), true, 'the build stays blocked until a table is picked');

    await pick.click();
    await onStep(page, 'Data');
    const select = page.getByLabel(`Table to use for ${PRIMARY}`, { exact: true });
    await select.waitFor({ timeout: 15000 });
    const replacement = await select.locator('option:not([disabled])').nth(1).getAttribute('value');
    assert.ok(replacement && replacement !== PRIMARY, `a replacement table is offered: ${replacement}`);
    const probesBefore = made.sqlCalls.filter((c) => /LIMIT 0$/.test(String(c.sql))).length;
    await select.selectOption(replacement);

    await goToStep(page, 'Review & build');
    await idle(page);
    const probesAfter = made.sqlCalls.filter((c) => /LIMIT 0$/.test(String(c.sql)));
    assert.ok(probesAfter.length > probesBefore, 'the preview runs again after the pick');
    assert.ok(probesAfter.some((c) => String(c.sql).includes(replacement.replace(/\./g, '`.`'))), `the preview probes ${replacement}`);
    assert.deepEqual(ui.pageErrors.filter((e) => !/409|Conflict/.test(e)), []);
  } finally {
    await ui.close();
  }
});
