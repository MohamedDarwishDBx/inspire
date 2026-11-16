// REQ-266 (REQ-193 reopen): the Data groups step of a one-model use case says plainly that the whole data is one group.
// It carries no refusal wording and no "nothing else to pick" on any step before the build.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUPING_INSTRUCTION as INSTRUCTION, GROUPING_PROFILE as PROFILE, HARNESS_USE_CASE, OWNER, } from './implementFixtures.js';
import { GROUPING_TITLE } from '../../src/lib/runScope.js';
import { closeBrowser, nextUntil, profileAt, onStep, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const ME = { userName: OWNER, displayName: 'Owner' };
const WHOLE = 'Inspire fits one model across all of main.sales.orders for Segmentation, so the whole data is one group.';
const ONE_MODEL_PROFILE = { ...PROFILE, one_model: true, qualifies: false, recommended: [], recommended_by: '', columns: [], group_column: null,
  group_list: [], group_sizes: [], group_count: 0, suggested_groups: [], example: null, reason: WHOLE };
const BANNED = ['is refused', 'nothing else to pick', 'refused when the use case is built', 'one registered model per group'];

test('REQ-266: Data groups for Segmentation says the whole data is one group, with no refusal or "nothing else to pick" (must-exclude)', async () => {
  const calls = [];
  const useCase = { ...HARNESS_USE_CASE, analytics_technique: 'Segmentation', genie_instruction: INSTRUCTION };
  const ui = await openUi('wizard', { me: ME, useCase }, '', { init: profileAt(calls, ONE_MODEL_PROFILE) });
  const { page } = ui;
  try {
    await nextUntil(page, 'Data groups');
    await onStep(page, 'Data groups');
    const grouping = page.getByRole('region', { name: GROUPING_TITLE, exact: true });
    await grouping.getByRole('heading', { name: GROUPING_TITLE }).waitFor();
    const plain = await grouping.locator('[data-grouping-nothing]').textContent();
    assert.equal(plain, WHOLE, 'the Whole data screen says plainly that the whole data is one group');
    for (const phrase of BANNED) assert.equal(plain.includes(phrase), false, `Data groups carries no "${phrase}" (must-exclude)`);
    const stepText = await page.locator('body').innerText();
    for (const phrase of BANNED) assert.equal(stepText.includes(phrase), false, `the Data groups step has no "${phrase}" anywhere (must-exclude)`);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await page.close?.();
  }
});

test('REQ-266: no earlier step of a one-model use case carries the refusal wording (must-exclude)', async () => {
  const calls = [];
  const useCase = { ...HARNESS_USE_CASE, analytics_technique: 'Segmentation', genie_instruction: INSTRUCTION };
  const ui = await openUi('wizard', { me: ME, useCase }, '', { init: profileAt(calls, ONE_MODEL_PROFILE) });
  const { page } = ui;
  try {
    await nextUntil(page, 'Data groups');
    await onStep(page, 'Data groups');
    const text = await page.locator('body').innerText();
    for (const phrase of BANNED) assert.equal(text.includes(phrase), false, `no "${phrase}" on the Data groups step (must-exclude)`);
  } finally {
    await page.close?.();
  }
});
