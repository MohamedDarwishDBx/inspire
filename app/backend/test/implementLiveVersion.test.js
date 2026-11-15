// REQ-241: one rule for the live App version. Under keep-previous the previous App (kept.assets, output 'app') serves the live App name;
// the newest build's App is the side App until it is published as live. The backend and the Build page read the same helpers.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);

const keptApp = (version, keptIn) => ({ output: 'app', id: 'app-v' + version, url: '', title: '', version, kept_in: keptIn });
const keepRows = () => [
  { spec_version: 6, status: 'ready', asset_status: { app: { state: 'ready', spec_version: 6 } } },
  { spec_version: 7, status: 'ready_with_warnings', asset_status: {
    app: { state: 'ready_with_warnings', spec_version: 7 }, kept: { state: 'kept', assets: [keptApp(6, 7)] } } },
];

test('under keep-previous the live App is the kept v6 and the newest build is the side App v7', async () => {
  const W = await lib('implementWizard.js');
  const C = await lib('implementControl.js');
  assert.equal(W.liveAppVersion(keepRows()), 6, 'the App that serves the live name is v6');
  assert.equal(W.sideAppVersion(keepRows()), 7, 'v7 is the side App, not live');
  assert.equal(C.liveVersion(keepRows()), 6, 'the control view names the same live version');
});

test('without a kept App the newest built App is live and there is no side App', async () => {
  const W = await lib('implementWizard.js');
  const rows = [{ spec_version: 6, status: 'ready', asset_status: { app: { state: 'ready', spec_version: 6 } } }];
  assert.equal(W.liveAppVersion(rows), 6);
  assert.equal(W.sideAppVersion(rows), null);
});

test('a kept entry of another output never changes the live App version', async () => {
  const W = await lib('implementWizard.js');
  const rows = keepRows();
  rows[1].asset_status.kept.assets = [{ output: 'alert', id: 'a', url: '', title: '', version: 5, kept_in: 7 }];
  assert.equal(W.liveAppVersion(rows), 7);
  assert.equal(W.sideAppVersion(rows), null);
});

test('the keep and remove choices name the live App version under keep-previous, and the newest version without one', async () => {
  const W = await lib('implementWizard.js');
  const [keep, remove] = W.vibePreviousChoices(W.liveVersionForVibes(keepRows()), 8);
  assert.equal(keep.label, 'Keep v6 live');
  assert.equal(remove.label, 'Remove v6 once v8 is ready');
  const plain = [{ spec_version: 3, status: 'ready', asset_status: { app: { state: 'ready', spec_version: 3 } } }];
  assert.equal(W.liveVersionForVibes(plain), 3);
  assert.deepEqual(W.appVersionLines(plain), { live: 'Live: v3', side: '' });
});

test('the backend live build row is the kept v6 under keep-previous, not the newest side App v7 (live_version in the History route)', () => {
  const I = require('../lib/inspireImplement');
  assert.equal(I.liveBuiltRow(keepRows()).spec_version, 6, 'the row whose App serves the live name');
  const plain = [{ spec_version: 3, status: 'ready', asset_status: { app: { state: 'ready', spec_version: 3 } } }];
  assert.equal(I.liveBuiltRow(plain).spec_version, 3, 'without a kept App the newest built row is live');
  assert.equal(I.liveBuiltRow([]), null, 'no built row means no live row');
});

// REQ-241 (D-LIVE), backend: fixture pinned on the real kept-entry shape read from a live status record (ids anonymised).
// The newest built row (v7) lists the kept older App in kept.assets; its own app_name/app_url is the side App.
const keptShapeRows = () => [
  { session_id: 's1', use_case_id: 'UC1', spec_version: 7, status: 'ready_with_warnings', app_name: 'side-app-v7', app_url: 'https://side.example.test',
    updated_at: '2026-11-15T04:00:00Z', spec_json: { use_case_name: 'Fraud', outputs: { app: true } },
    asset_status: { app: { state: 'ready', spec_version: 7, snapshot: true },
      kept: { state: 'kept', assets: [{ output: 'app', id: 'kept-app-live', url: 'https://kept.example.test', title: 'kept-app-live', version: 6, kept_in: 7 }] } } },
  { session_id: 's1', use_case_id: 'UC1', spec_version: 6, status: 'ready', app_name: 'kept-app-live', app_url: 'https://kept.example.test',
    updated_at: '2026-11-14T04:00:00Z', spec_json: { use_case_name: 'Fraud', outputs: { app: true } },
    asset_status: { app: { state: 'ready', spec_version: 6, snapshot: true } } },
];

test('the live App name and URL come from the kept entry, never the side App (appShellUpdate and the publish listing)', () => {
  const I = require('../lib/inspireImplement');
  const rows = keptShapeRows();
  assert.deepEqual(I.liveAppOf(rows), { name: 'kept-app-live', url: 'https://kept.example.test', version: 6 });
  const pages = I.runPages(rows);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].kind, 'app');
  assert.equal(pages[0].app_name, 'kept-app-live', 'the publish listing names the live App, not the side App');
  assert.equal(pages[0].app_url, 'https://kept.example.test');
  assert.equal(pages[0].version, 6, 'the App page carries the live App version');
  const update = I.appShellUpdate(rows, { version: '9.9.9', shell: 'new-shell' });
  assert.equal(update && update.version, 6, 'the App code update targets the kept live App v6');
});

test('without a kept App the publish listing and App update use the newest built row own App', () => {
  const I = require('../lib/inspireImplement');
  const plain = [{ session_id: 's1', use_case_id: 'UC1', spec_version: 3, status: 'ready', app_name: 'app-v3', app_url: 'https://v3.example.test',
    updated_at: '2026-11-15T04:00:00Z', spec_json: { use_case_name: 'Fraud', outputs: { app: true } }, asset_status: { app: { state: 'ready', spec_version: 3, snapshot: true } } }];
  assert.deepEqual(I.liveAppOf(plain), { name: 'app-v3', url: 'https://v3.example.test', version: 3 });
  assert.equal(I.runPages(plain)[0].app_name, 'app-v3');
});
