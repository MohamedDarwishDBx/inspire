import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, expandBuild, openUi, until } from './uiSupport.mjs';
import { built, STUDIO_STATE } from './implementFixtures.js';

test.after(closeBrowser);

const NOTHING_BUILT = { result_rows: null, asset_status: null, dashboard_id: null, dashboard_url: null, genie_space_id: null, genie_space_url: null,
  app_name: null, app_url: null, alert_id: null, alert_url: null };
const BUILDING = (section) => section.getByRole('region', { name: 'Building' });
const USE_CASES = (page) => page.getByRole('navigation', { name: 'Use cases' });

// REQ-355: Try again queues a build. The card says queued until the run starts, then running (never running while queued).
test('Try again shows its build as MVP queued on the card, not MVP running (REQ-355)', async () => {
  const log = { submits: 0 };
  let release = () => {};
  const held = new Promise((resolve) => { release = resolve; });
  const mount = (app) => {
    app.post('/api/inspire/implement/submit', async (req, res) => {
      log.submits += 1;
      await held;
      res.json({ session_id: '42', use_case_id: req.body.spec.use_case_id, spec_version: 2, summary: {}, warnings: [] });
    });
  };
  const failed = built({ spec_version: 1, status: 'failed', status_message: 'the Genie build stopped on a step', ...NOTHING_BUILT });
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [failed] }, '', { mount });
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await expandBuild(page);
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await until(() => log.submits === 1, 'one build submitted');
    await BUILDING(USE_CASES(page)).getByText('MVP queued', { exact: true }).waitFor({ timeout: 15000 });
    await page.getByRole('region', { name: 'Build summary' }).getByText('1 MVP queued', { exact: true }).waitFor({ timeout: 15000 });
    assert.equal(await page.getByRole('region', { name: 'Build summary' }).getByText('building now', { exact: false }).count(), 0, 'the summary does not say building now for a queued build');
    assert.equal(await BUILDING(USE_CASES(page)).getByText('MVP running', { exact: true }).count(), 0,
      'a queued build never reads running (must-fail: the card label collapsed queued into running)');
    // The side panel shows the queued build, not the failed block of the superseded run, until the server answers.
    assert.equal(await page.getByRole('region', { name: 'Build failed' }).count(), 0, 'no failed block while the queued build is pending (must-fail: the detail read the old failed status)');
    assert.doesNotMatch(await page.locator('[data-progress-card]').innerText(), /Failed/, 'the progress card does not read Failed while queued');
    assert.doesNotMatch(await page.getByRole('region', { name: 'Build summary' }).innerText(), /stopped on a step/, 'the summary does not quote the superseded failure (must-fail: the overlay kept its status message)');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    release();
    await ui.close();
  }
});

// REQ-356: after a reload the build progress follows the version the card shows. A failed v1 does not colour the building v2.
test('after a reload the build progress follows the v2 the card shows, not the failed v1 (REQ-356)', async () => {
  const v2 = built({ spec_version: 2, status: 'building_outputs', implement_run_id: '5555555555555555', updated_at: new Date().toISOString(), ...NOTHING_BUILT });
  const v1 = built({ spec_version: 1, status: 'failed', status_message: 'the Genie build stopped on a step', ...NOTHING_BUILT });
  const step = (phase, status, time, specVersion) => ({
    stage_name: 'Implement Use Cases', step_id: `${phase}-${specVersion}-${time}`, step_name: `Inspire is working on ${phase.toLowerCase()}`,
    sub_step_name: 'Completed: n01-u01', status, last_updated: `2026-10-26T${time}.000Z`,
    result_json: JSON.stringify({ use_case_id: 'N01-U01', phase, spec_version: specVersion }),
  });
  const steps = [step('Plan', 'ended_success', '10:01:00', 1), step('Genie build', 'started', '10:04:05', 1), step('Genie build', 'ended_error', '10:20:00', 1)];
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [v2, v1], steps,
    implementRun: { run_id: 5555555555555555, state: { life_cycle_state: 'RUNNING' } } });
  const { page } = ui;
  try {
    await expandBuild(page);
    await page.locator('[data-mvp-progress] [data-stop-build]').waitFor({ timeout: 20000 });
    // The build stages of the progress panel: v1's failed Genie build must not mark a stage of the building v2 as failed.
    const stages = await page.locator('[aria-label="Build stages"] [data-stage]').evaluateAll((els) => els.map((el) => `${el.dataset.stage}=${el.dataset.stageState}`));
    assert.ok(stages.length > 0, 'the build stages render, so the check below is not an empty match');
    const failedStages = await page.locator('[aria-label="Build stages"] [data-stage-state="error"]').count();
    assert.equal(failedStages, 0, `no stage of the building v2 reads failed from v1 (must-fail before the version filter): ${stages.join(', ')}`);
    assert.equal(await page.getByRole('region', { name: 'Build failed' }).count(), 0, 'no failed banner for the building v2');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
