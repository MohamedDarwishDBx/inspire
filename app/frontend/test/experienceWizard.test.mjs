import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_EXPERIENCE_CHOICES, APP_EXPERIENCE_DEFAULT, IMPLEMENT_OUTPUTS, experienceDefault, experienceOf, withAppOption } from '../src/lib/implementWizard.js';

test('the delivery step labels the App "Agentic App" (REQ-209)', () => {
  const app = IMPLEMENT_OUTPUTS.find((o) => o.id === 'app');
  assert.equal(app.label, 'Agentic App');
});

test('the experience decision offers Agentic (default), Classic UI and Both, and Agentic is the default', () => {
  assert.deepEqual(APP_EXPERIENCE_CHOICES.map((c) => c.id), ['agentic', 'ui', 'both']);
  assert.equal(APP_EXPERIENCE_DEFAULT, 'agentic');
  assert.equal(APP_EXPERIENCE_CHOICES[0].label, 'Agentic (default)');
});

test('an unknown experience falls back to the default, and a chosen one is kept', () => {
  assert.equal(experienceOf('bogus'), 'agentic');
  assert.equal(experienceOf('ui'), 'ui');
});

test('choosing an experience keeps the string; the other options stay booleans', () => {
  const spec = { outputs: { app_options: { modify: true, decisions: true } } };
  const next = withAppOption(spec, 'experience', 'both');
  assert.equal(next.outputs.app_options.experience, 'both');
  assert.equal(withAppOption(next, 'decisions', false).outputs.app_options.decisions, false);
});

test('a rebuild pre-selects classic (ui) when the App never chose; a new build pre-selects agentic', () => {
  assert.equal(experienceDefault({ based_on_version: 3 }), 'ui');
  assert.equal(experienceDefault({}), 'agentic');
});
