// REQ-193: a family C use case (segmentation) fits one registered model, so its Data groups step offers only the whole data and says why.
// The column is not offered on the page, and the save refuses one (node tests in app/backend/test/implementOneModelSave.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUPING_INSTRUCTION as INSTRUCTION, GROUPING_PROFILE as PROFILE, HARNESS_USE_CASE, OWNER, built } from './implementFixtures.js';
import { GROUPING_PLAIN, GROUPING_TITLE } from '../../src/lib/runScope.js';
import { closeBrowser, nextUntil, profileAt, onStep, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const ME = { userName: OWNER, displayName: 'Owner' };
// REQ-266: the Data groups step says plainly that the whole data is one group (no refusal wording).
const ONE_MODEL_REASON = 'Inspire fits one model across all of main.sales.orders for Segmentation, so the whole data is one group.';
const ONE_MODEL_PROFILE = { ...PROFILE, one_model: true, qualifies: false, recommended: [], recommended_by: '', columns: [], group_column: null,
  group_list: [], group_sizes: [], group_count: 0, suggested_groups: [], example: null, reason: ONE_MODEL_REASON };

test('REQ-193: a Segmentation use case offers only the whole data on Data groups and says why, with no column offered', async () => {
  const calls = [];
  const useCase = { ...HARNESS_USE_CASE, analytics_technique: 'Segmentation', genie_instruction: INSTRUCTION };
  const ui = await openUi('wizard', { me: ME, useCase }, '', { init: profileAt(calls, ONE_MODEL_PROFILE) });
  const { page } = ui;
  try {
    await nextUntil(page, 'Data groups');
    await onStep(page, 'Data groups');
    const grouping = page.getByRole('region', { name: GROUPING_TITLE, exact: true });
    await grouping.getByRole('heading', { name: GROUPING_TITLE }).waitFor();
    assert.deepEqual(await grouping.locator('[data-grouping-choice]').evaluateAll((rows) => rows.map((r) => r.dataset.groupingChoice)), ['all'],
      'only the whole data is offered for a one-model kind');
    assert.equal(await grouping.locator('[data-grouping-nothing]').textContent(), ONE_MODEL_REASON,
      'one plain sentence says the whole data is one group, and nothing else is offered');
    assert.equal(await grouping.locator('[data-grouping-why]').textContent(), GROUPING_PLAIN);
  } finally {
    await page.close?.();
  }
});
