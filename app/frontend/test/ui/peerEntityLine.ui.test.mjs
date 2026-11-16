// REQ-293 round 3: the Data groups step of a peer comparison says, in one plain line, which key each record compares, so that key cannot
// also be the group. Another use case shows no such line (must-exclude).
import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUPING_INSTRUCTION as INSTRUCTION, GROUPING_PROFILE as PROFILE, HARNESS_USE_CASE, OWNER } from './implementFixtures.js';
import { GROUPING_TITLE } from '../../src/lib/runScope.js';
import { closeBrowser, nextUntil, profileAt, onStep, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const ME = { userName: OWNER, displayName: 'Owner' };
const LINE = 'franchiseID is what each record compares, so it cannot also be the group.';

async function dataGroups(profile, technique) {
  const calls = [];
  const useCase = { ...HARNESS_USE_CASE, analytics_technique: technique, genie_instruction: INSTRUCTION };
  const ui = await openUi('wizard', { me: ME, useCase }, '', { init: profileAt(calls, profile) });
  await nextUntil(ui.page, 'Data groups');
  await onStep(ui.page, 'Data groups');
  const grouping = ui.page.getByRole('region', { name: GROUPING_TITLE, exact: true });
  await grouping.getByRole('heading', { name: GROUPING_TITLE }).waitFor();
  return { page: ui.page, grouping };
}

test('REQ-293: a peer comparison shows one plain line that its entity key is what each record compares, not a group', async () => {
  const { page, grouping } = await dataGroups({ ...PROFILE, peer_entity: ['franchiseID'] }, 'Peer Benchmarking');
  try {
    assert.equal(await grouping.locator('[data-grouping-peer-entity]').textContent(), LINE);
    assert.equal(await grouping.locator('[data-grouping-choice][data-grouping-choice="franchiseID"]').count(), 0, 'the key is not offered as a group');
  } finally {
    await page.close?.();
  }
});

test('REQ-293: a use case with no peer entity shows no such line (must-exclude)', async () => {
  const { page, grouping } = await dataGroups({ ...PROFILE, peer_entity: [] }, 'Anomaly Detection');
  try {
    assert.equal(await grouping.locator('[data-grouping-peer-entity]').count(), 0);
  } finally {
    await page.close?.();
  }
});
