// The App's experience choice (agentic, ui, both): the wizard keeps an answer it offers, and refuses any other value.
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/inspireImplement');
const IMPLEMENT_OPTIONS = { modify: false, replace_edits: false, decisions: true, alerts: false };

const BASE = {
  use_case_id: 'N01-U01',
  use_case_name: 'Predict churn',
  config: { warehouse_id: 'wh1', result_table: 'main.inspire.n01_u01_out' },
  outputs: { dashboard: true, genie_space: true, app: true, app_name: 'churn-desk', app_access: 'sp', inspire_url: 'https://inspire.example.com' },
};
const errorsFor = (appOptions) => I.validateImplementSpec({ ...BASE, outputs: { ...BASE.outputs, app_options: appOptions } }).errors;

test('the three experiences are accepted as the App option', () => {
  for (const experience of ['agentic', 'ui', 'both']) {
    assert.deepEqual(errorsFor({ experience }).filter((e) => e.includes('experience')), [], experience);
  }
});

test('an experience the App does not offer is refused, and a boolean is refused for it', () => {
  assert.ok(errorsFor({ experience: 'chat' }).includes("the App experience 'chat' is not one Inspire offers; pick one of agentic, ui, both"));
  assert.ok(errorsFor({ experience: true }).some((e) => e.startsWith('the App experience true is not one Inspire offers')));
});

test('an unknown option is still refused, and the boolean options still must be booleans', () => {
  assert.ok(errorsFor({ export: true }).includes("the App has no option 'export'; its options are modify, replace_edits, decisions, alerts"));
  assert.ok(errorsFor({ decisions: 'yes' }).includes("the App option decisions must be true or false, not 'yes'"));
});

test('an accepted experience is kept on the spec', () => {
  const out = I.validateImplementSpec({ ...BASE, outputs: { ...BASE.outputs, app_options: { experience: 'both' } } });
  assert.equal(out.spec.outputs.app_options.experience, 'both');
});

test('a new build starts agentic when the spec names no experience', () => {
  const out = I.validateImplementSpec({ ...BASE, outputs: { ...BASE.outputs } });
  assert.equal(out.spec.outputs.app_options.experience, 'agentic');
});

test('a rebuild of an App that never chose an experience keeps it classic (ui)', () => {
  const out = I.validateImplementSpec({ ...BASE, based_on_version: 3, outputs: { ...BASE.outputs } });
  assert.equal(out.spec.outputs.app_options.experience, 'ui');
});

test('a rebuild keeps the experience the App already has, and the wizard choice wins over the default', () => {
  const kept = I.validateImplementSpec({ ...BASE, based_on_version: 3, outputs: { ...BASE.outputs, app_options: { experience: 'both' } } });
  assert.equal(kept.spec.outputs.app_options.experience, 'both');
  const fresh = I.validateImplementSpec({ ...BASE, outputs: { ...BASE.outputs, app_options: { experience: 'ui' } } });
  assert.equal(fresh.spec.outputs.app_options.experience, 'ui');
});

// A stored build with no experience key is a classic App: validated as the build a rebuild starts from, it stays ui, so the
// rebuild (ui) is not an experience change. Without a live App the same spec is a new build and starts agentic.
test('a stored build with no experience key stays classic, so a rebuild of it does not change the App experience', () => {
  const stored = I.validateImplementSpec(BASE, { appExperience: 'ui' }).spec;
  assert.equal(stored.outputs.app_options.experience, 'ui');
  assert.equal(I.validateImplementSpec(BASE).spec.outputs.app_options.experience, 'agentic');
  const rebuild = I.validateImplementSpec({ ...BASE, based_on_version: 1 }).spec;
  assert.equal(rebuild.outputs.app_options.experience, 'ui');
  assert.ok(!I.classifyImplementChange({ outputs: stored.outputs }, { outputs: rebuild.outputs }).includes('outputs'));
});

test('changing the experience of an App is an outputs change', () => {
  const app = (experience) => ({ outputs: { app: true, app_name: 'churn-desk', app_options: { ...IMPLEMENT_OPTIONS, experience } } });
  assert.ok(I.classifyImplementChange(app('ui'), app('agentic')).includes('outputs'));
  assert.ok(I.classifyImplementChange(app('ui'), app('both')).includes('outputs'));
});
