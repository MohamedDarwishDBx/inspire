const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const I = require('../lib/inspireImplement');
const { makeApp, listen } = require('./support/implementApp');



const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);

const OWNER = ['owner', 'example.com'].join('@');
const APP_OWNER = ['lee', 'example.com'].join('@');
const OTHER = ['someone.else', 'example.com'].join('@');
const PERSON = 'person-token';
const APP_URL = 'https://churn-desk-1.aws.databricksapps.com';
const DB = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42' };
const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42&use_case_id=N01-U01';
const BASE = {
  use_case_id: 'N01-U01',
  use_case_name: 'Predict churn',
  config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out', widgets: { act_now_share: '0.05' } },
  outputs: { dashboard: true, inspire_url: 'https://inspire.example.com' },
};
const MODEL = [
  { name: 'WEEKS_LEFT', label: 'Weeks left', group: 'impact', kind: 'number', low: 1, high: 52, allowed: '1 to 52', source: 'assumption', default: 12,
    reason: 'the value the notebook defines', applies: 'app_and_run' },
  { name: 'act_now_share', label: 'Act now share', group: 'flagging', kind: 'percent', low: 0, high: 1, allowed: '0 to 1', source: 'widget', default: '0.05',
    reason: "Inspire's default", applies: 'run' },
  { name: 'review_share', label: 'Review share', group: 'flagging', kind: 'percent', low: 0, high: 1, allowed: '0 to 1', source: 'widget', default: '0.15',
    reason: "Inspire's default", applies: 'run' },
];
const WIDGETS = [{ name: 'act_now_share', type: 'text', default: '0.05', allowed: '0 to 1' }, { name: 'review_share', type: 'text', default: '0.15', allowed: '0 to 1' },
  { name: 'top_k', type: 'text', default: '25', allowed: 'whole number, at least 1' }];

function clean(top = {}) {
  const out = I.validateImplementSpec({ ...JSON.parse(JSON.stringify(BASE)), ...top });
  assert.deepEqual(out.errors, [], JSON.stringify(top));
  return out.spec;
}

const builtRow = ({ assets = {}, ...extra } = {}) => ({
  session_id: '42', use_case_id: 'N01-U01', spec_version: 1, status: 'ready', created_by: OWNER, updated_at: '2026-10-21T04:00:00Z',
  spec_json: JSON.stringify({ ...clean(), outputs: { dashboard: true, app: true, app_name: 'churn-desk', app_access: 'sp', app_owners: [APP_OWNER], genie_space: true, inspire_url: 'https://inspire.example.com' } }),
  notebook_path: '/W/impl/N01-U01', job_id: '77', dashboard_id: 'd1', dashboard_url: 'https://w/d1', app_name: 'churn-desk', app_url: APP_URL,
  genie_widgets: JSON.stringify(WIDGETS),
  asset_status: JSON.stringify({ dashboard: { state: 'ready', spec_version: 1 }, notebook: { state: 'ready', spec_version: 1, result_history: 1 },
    app: { state: 'ready', spec_version: 1 }, settings: MODEL, ...assets }),
  ...extra,
});

async function withApp(overrides, run) {
  const made = makeApp({ history: [builtRow()], ...overrides });
  const srv = await listen(made.app);
  try {
    await run(srv.url, made);
  } finally {
    await srv.close();
  }
}

async function call(base, url, { method = 'GET', body, who = OWNER } = {}) {
  const resp = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'x-forwarded-email': who }, body: body ? JSON.stringify(body) : undefined });
  return { status: resp.status, data: await resp.json() };
}

const SEGMENTATION = { id: 'N01-U01', use_case: 'Group customers for tailored offers', analytics_technique: 'Segmentation',
  genie_instruction: '## Parameters\n| widget | type | default | allowed | used for |\n|---|---|---|---|---|\n| `group_by` | text | all | | Data groups |\n' };
const ANOMALY = { ...SEGMENTATION, analytics_technique: 'Anomaly Detection' };
const REASON = /^Data groups is '[^']+': this use case fits one model across all of the data/;

test('REQ-193: a column Grouping for a family C use case is refused on save and never reaches the App (fail-pre: forwarded)', async () => {
  await withApp({ forwardedToken: PERSON, useCase: SEGMENTATION, appApi: { 'POST /api/settings/save': [{ saved: true }] } }, async (url, made) => {
    const refused = await call(url, `/api/inspire/implement/settings/save?${Q}`, { method: 'POST', body: { name: 'group_by', value: 'region', was: 'all', note: '' } });
    assert.equal(refused.status, 400, JSON.stringify(refused.data));
    assert.match(refused.data.error, REASON);
    assert.equal(made.fetches.some((f) => String(f.path).includes('/api/settings/save')), false, 'the App is never asked to save it');
    const preview = await call(url, `/api/inspire/implement/settings/preview?${Q}`, { method: 'POST', body: { name: 'group_by', value: 'region,country' } });
    assert.equal(preview.status, 400);
    assert.match(preview.data.error, REASON);
  });
});

test('REQ-193: the whole data is still saved for family C, and an anomaly column is still saved (must-exclude)', async () => {
  const appApi = { 'POST /api/settings/save': [{ settings: [], saved: true }] };
  await withApp({ forwardedToken: PERSON, useCase: SEGMENTATION, appApi }, async (url) => {
    const all = await call(url, `/api/inspire/implement/settings/save?${Q}`, { method: 'POST', body: { name: 'group_by', value: 'all', was: 'region', note: '' } });
    assert.equal(all.status, 200, JSON.stringify(all.data));
  });
  await withApp({ forwardedToken: PERSON, useCase: ANOMALY, appApi }, async (url) => {
    const kept = await call(url, `/api/inspire/implement/settings/save?${Q}`, { method: 'POST', body: { name: 'group_by', value: 'region', was: 'all', note: '' } });
    assert.equal(kept.status, 200, 'an anomaly use case keeps its planned Grouping (must-exclude)');
  });
});
