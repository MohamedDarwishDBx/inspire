import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, expandBuild, openUi, until } from './uiSupport.mjs';
import { built, STUDIO_STATE } from './implementFixtures.js';

test.after(closeBrowser);

const NOTHING_BUILT = { result_rows: null, asset_status: null, dashboard_id: null, dashboard_url: null, genie_space_id: null, genie_space_url: null,
  app_name: null, app_url: null, alert_id: null, alert_url: null };
const FIFTEEN_HOURS_AGO = new Date(Date.now() - 15 * 60 * 60 * 1000).toISOString();

// REQ-386: Try again on a failed v1 that started 15 hours ago. While the submit is pending the panel names the next version (v2),
// counts time from the click, and carries no span or Job timing of the superseded v1 run.
test('Try again on a failed v1 shows the queued v2 with the click time, not v1 running for 15 hours (REQ-386)', async () => {
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
  const failed = built({ spec_version: 1, status: 'failed', status_message: 'the Genie build stopped on a step', created_at: FIFTEEN_HOURS_AGO, ...NOTHING_BUILT });
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [failed] }, '', { mount });
  const { page } = ui;
  const panel = () => page.locator('[data-mvp-progress]');
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await expandBuild(page);
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await until(() => log.submits === 1, 'one build submitted');
    await panel().locator('[aria-label="Build stages"] [data-stage="Job"]').waitFor({ timeout: 15000 });
    const panelText = await panel().innerText();
    assert.match(panelText, /Build progress · v2/, `the panel names the queued next version, not v1 (panel: ${JSON.stringify(panelText.slice(0, 160))})`);
    assert.doesNotMatch(panelText, /Build progress · v1/, 'the superseded v1 is not the version shown');
    assert.doesNotMatch(panelText, /Running for 1\d+h|Running for \d+d|\b1[0-9]h \d+m/, 'no span counted from the superseded v1 run (must-fail: 15h 17m before the fix)');
    const jobStage = await panel().locator('[aria-label="Build stages"] [data-stage="Job"]').innerText();
    assert.doesNotMatch(jobStage, /\d+h|\d+d/, `the Job chip counts from the click, not from v1 (shown: ${jobStage})`);
    // Screenshots for the lane report: U9_SHOTS=<dir> writes the queued panel at both review sizes. Off by default.
    if (process.env.U9_SHOTS) {
      for (const [width, height] of [[1440, 900], [1280, 800]]) {
        await page.setViewportSize({ width, height });
        await page.screenshot({ path: `${process.env.U9_SHOTS}/req386_queued_v2_${width}x${height}.png` });
      }
    }
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    release();
    await ui.close();
  }
});

// REQ-375 class (REQ-386 follow-up): a build queued from the detail (Try again) closes the Start Use Case MVP dialog that is open over it.
test('Try again on the detail closes the Start Use Case MVP dialog open over it, once the build is queued (REQ-386)', async () => {
  const log = { submits: 0 };
  let release = () => {};
  const held = new Promise((resolve) => { release = resolve; });
  const mount = (app) => {
    app.post('/api/inspire/implement/submit', async (req, res) => {
      log.submits += 1;
      await held;
      res.json({ session_id: '42', use_case_id: req.body.spec.use_case_id, spec_version: 3, summary: {}, warnings: [] });
    });
  };
  const failed = built({ spec_version: 2, status: 'failed', status_message: 'App not published: Inspire tried 2 times and could not build it', created_at: FIFTEEN_HOURS_AGO, ...NOTHING_BUILT });
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [failed, built()] }, '', { mount });
  const { page } = ui;
  const wizard = () => page.getByRole('dialog', { name: /^Start Use Case MVP with Genie/ });
  try {
    await page.getByRole('button', { name: 'Change choices and build again', exact: true }).click();
    await wizard().waitFor({ timeout: 15000 });
    // The wizard covers the detail, so Try again is reached through the detail's own button (the same control a person would click after closing it).
    const tryAgain = page.getByRole('button', { name: 'Try again', exact: true, includeHidden: true });
    await tryAgain.first().dispatchEvent('click');
    await until(() => log.submits === 1, 'one build submitted from the detail');
    await page.locator('[data-mvp-progress] [aria-label="Build stages"] [data-stage="Job"]').waitFor({ timeout: 15000 });
    assert.equal(await wizard().count(), 0, 'the Start Use Case MVP dialog closes once a build is queued from the detail (must-fail before the fix: it stayed open at step 1 of 7 over the progress panel)');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    release();
    await ui.close();
  }
});
