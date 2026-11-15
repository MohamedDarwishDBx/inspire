import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSpecFromUseCase } from '../../src/lib/implementWizard.js';
import { HARNESS_INSPIRE_URL, HARNESS_USE_CASE, HARNESS_SETTINGS, HARNESS_SESSION_ID } from './implementFixtures.js';
import { closeBrowser, openAsset, openUi } from './uiSupport.mjs';

// REQ-241: the Build page names the live App version and the side App of a keep-previous build, and never calls the side App live.
const OWNER = ['owner', 'example.com'].join('@');
test.after(closeBrowser);

const builtSpec = (top = {}) => {
  const spec = defaultSpecFromUseCase(HARNESS_USE_CASE, { warehouseId: HARNESS_SETTINGS.warehouseId, inspireDatabase: HARNESS_SETTINGS.inspireDatabase, sessionId: HARNESS_SESSION_ID, owner: OWNER });
  return { ...spec, ...top, outputs: { ...spec.outputs, genie_space: true, app: true, app_name: 'churn-desk', app_access: 'sp', alert: true, alert_recipients: [OWNER],
    inspire_url: HARNESS_INSPIRE_URL } };
};
const ready = (version, extra = {}) => ({ state: 'ready', spec_version: version, ...extra });
const LIVE = { dashboard: ready(3, { snapshot: true }), genie_space: ready(3, { snapshot: true }), app: ready(3, { snapshot: true }), alert: ready(3) };

const versionRow = (version, { assets = LIVE, top = {}, ...extra } = {}) => ({
  session_id: '42', use_case_id: 'N01-U01', spec_version: version, status: 'ready', change_classes: version === 1 ? 'initial' : 'outputs', created_by: OWNER,
  updated_at: `2026-10-2${version}T04:00:00Z`, spec_json: JSON.stringify(builtSpec(top)), job_id: '77', last_preview_run_id: '9001', result_rows: '3',
  notebook_path: '/Users/owner@example.com/inspire/Acme_implemented/N01-U01',
  dashboard_id: 'd1', dashboard_url: 'https://workspace.example.com/dashboardsv3/d1/published',
  genie_space_id: 'g1', genie_space_url: 'https://workspace.example.com/genie/rooms/g1',
  app_name: 'churn-desk', app_url: 'https://churn-desk-1.aws.example.com',
  alert_id: 'a1', alert_url: 'https://workspace.example.com/sql/alerts-v2/a1',
  asset_status: JSON.stringify(assets),
  ...extra,
});


const keptApp = (version, keptIn) => ({ output: 'app', id: `app-v${version}`, url: '', title: '', version, kept_in: keptIn });
const SIDE = { ...LIVE, app: ready(7), kept: { state: 'kept', assets: [keptApp(6, 7)] } };

async function openHistory(ui) {
  await ui.page.locator('[data-asset-tile="job"] [data-tile-versions]').waitFor({ timeout: 15000 });
  const drawer = await openAsset(ui.page, 'job');
  await drawer.getByRole('region', { name: 'History', exact: true }).getByText(/^\d+ spec versions? · /).waitFor({ timeout: 15000 });
  return drawer;
}

async function openBuild(history) {
  const ui = await openUi('implement', { history, appExists: true, app: { name: 'churn-desk', description: 'Inspire use case N01-U01 (session 42): Predict churn', compute_status: { state: 'ACTIVE' }, app_status: { state: 'RUNNING' } } });
  try {
    await ui.page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await ui.page.getByRole('heading', { name: 'Predict churn', exact: true }).waitFor({ timeout: 15000 });
  } catch (e) {
    await ui.close();
    throw e;
  }
  return ui;
}

test('under keep-previous the Build page says Live: v6 and Side App: v7 (not live yet)', async () => {
  const ui = await openBuild([versionRow(7, { change_classes: 'vibe', assets: SIDE }), versionRow(6, { assets: { ...LIVE, app: ready(6) } }), versionRow(5)]);
  try {
    await openHistory(ui);
    assert.equal((await ui.page.locator('[data-app-live]').textContent()).trim(), 'Live: v6');
    assert.equal((await ui.page.locator('[data-app-side]').textContent()).trim(), 'Side App: v7 (not live yet)');
  } finally {
    await ui.close();
  }
});

test('without a kept App the Build page names no side App and the newest App as live', async () => {
  const ui = await openBuild([versionRow(3), versionRow(2), versionRow(1)]);
  try {
    await openHistory(ui);
    assert.equal((await ui.page.locator('[data-app-live]').textContent()).trim(), 'Live: v3');
    assert.equal(await ui.page.locator('[data-app-side]').count(), 0, 'no side App is shown when nothing is kept');
  } finally {
    await ui.close();
  }
});

// REQ-241 (D-LIVE): the App card's Versions panel uses the same live rule as the Build page: the kept v6 serves the live App name, the side App v8 is not live.
const SIDE_V8 = { ...LIVE, app: ready(8), kept: { state: 'kept', assets: [keptApp(6, 8)] } };

test('the App Versions panel marks the kept v6 Live and the side v8 as not live yet', async () => {
  const ui = await openBuild([versionRow(8, { change_classes: 'vibe', assets: SIDE_V8 }), versionRow(6, { assets: { ...LIVE, app: ready(6) } }), versionRow(5)]);
  try {
    const versions = (await openAsset(ui.page, 'app')).getByRole('region', { name: 'Versions', exact: true });
    const live = versions.locator('[data-live-version]');
    await live.getByText('Live', { exact: true }).waitFor({ timeout: 15000 });
    assert.equal(await live.getAttribute('data-version'), '6', 'the kept v6 serves the live App name');
    assert.equal(await versions.locator('[data-live-version]').count(), 1, 'only one version is Live');
    const side = versions.locator('[data-side-version]');
    assert.equal(await side.getAttribute('data-version'), '8');
    assert.equal((await side.textContent()).includes('Side App (not live yet)'), true, 'the side App is labelled not live');
    assert.equal((await side.textContent()).includes('Live'), false, 'the side App is never labelled Live');
    assert.equal(await versions.locator('[data-version="8"]').count(), 1, 'v8 is listed once');
    assert.equal(await versions.locator('[data-version="8"] button').count(), 0, 'the side App is not a roll back target');
  } finally {
    await ui.close();
  }
});

test('a normal rebuild with no side App marks the newest App version Live', async () => {
  const ui = await openBuild([versionRow(3), versionRow(2), versionRow(1)]);
  try {
    const versions = (await openAsset(ui.page, 'app')).getByRole('region', { name: 'Versions', exact: true });
    await versions.locator('[data-live-version]').getByText('Live', { exact: true }).waitFor({ timeout: 15000 });
    assert.equal(await versions.locator('[data-live-version]').getAttribute('data-version'), '3');
    assert.equal(await versions.locator('[data-side-version]').count(), 0, 'no side App when nothing is kept');
  } finally {
    await ui.close();
  }
});
