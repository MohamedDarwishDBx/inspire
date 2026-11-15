// REQ-272: the Data groups step of the Build wizard has a Load groups control that is reachable while the default is Whole data.
// It lists the groups of a column Inspire can group by, and says plainly why it cannot for a one-model kind.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUPING_PROFILE as PROFILE, HARNESS_USE_CASE, OWNER } from './implementFixtures.js';
import { GROUPING_TITLE } from '../../src/lib/runScope.js';
import { closeBrowser, nextUntil, onStep, openUi, profileAt } from './uiSupport.mjs';

test.after(closeBrowser);

const ME = { userName: OWNER, displayName: 'Owner' };
const ONE_MODEL_PROFILE = { ...PROFILE, one_model: true, qualifies: false, recommended: [], recommended_by: '', group_column: null, group_list: [],
  group_sizes: [], group_count: 0, suggested_groups: [], example: null, reason: 'one model' };
const ONE_MODEL_LOAD_WHY = 'Inspire fits one model for this use case, so the whole data is one group and there are no groups to load.';

async function toDataGroups(calls, profile) {
  const useCase = { ...HARNESS_USE_CASE, analytics_technique: 'Clustering' };
  const ui = await openUi('wizard', { me: ME, useCase }, '', { init: profileAt(calls, profile) });
  await nextUntil(ui.page, 'Data groups');
  await onStep(ui.page, 'Data groups');
  const grouping = ui.page.getByRole('region', { name: GROUPING_TITLE, exact: true });
  await grouping.getByRole('heading', { name: GROUPING_TITLE }).waitFor();
  return { ui, grouping };
}

test('REQ-272: Load groups is on the Data groups step while Whole data stays the default, and it lists the groups of a chosen column', async () => {
  const calls = [];
  const { ui, grouping } = await toDataGroups(calls, PROFILE);
  const { page } = ui;
  try {
    const checked = grouping.locator('input[name="inspire-grouping"]:checked');
    const before = await checked.getAttribute('value');
    const load = grouping.getByRole('button', { name: 'Load groups', exact: true });
    await load.waitFor();
    assert.equal(await load.isDisabled(), false, 'the control is reachable without choosing a column first');
    await grouping.getByRole('combobox', { name: 'Column to load groups for', exact: true }).selectOption('country');
    await load.click();
    const list = grouping.getByRole('list', { name: 'Groups of country', exact: true });
    await list.waitFor();
    const rows = await list.locator('li').allInnerTexts();
    assert.match(rows[0], /^USA\s+18,200$/, 'the largest group comes first with its record count');
    assert.equal(rows.length, PROFILE.column_groups.country.length);
    assert.equal(await checked.getAttribute('value'), before, 'loading groups does not change the grouping');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('REQ-272: for a one-model kind the Load groups control is there, disabled, and says plainly why nothing loads', async () => {
  const calls = [];
  const { ui, grouping } = await toDataGroups(calls, ONE_MODEL_PROFILE);
  try {
    const load = grouping.getByRole('button', { name: 'Load groups', exact: true });
    await load.waitFor();
    assert.equal(await grouping.locator('input[name="inspire-grouping"]:checked').getAttribute('value'), 'all', 'Whole data is the default');
    assert.equal(await load.isDisabled(), true);
    assert.equal(await grouping.locator('[data-load-groups-why]').textContent(), ONE_MODEL_LOAD_WHY);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
