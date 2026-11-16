import test from 'node:test';
import assert from 'node:assert/strict';
import { profileFileName, profileFileText, sameSettings } from '../src/lib/businessProfiles.js';

const form = { params: { '00_business_name': 'Acme', '03_discovery_type': 'Deep' }, priorityChecks: { growth: true }, electionTouched: true, discoveryTouched: false };

test('a form equals its saved profile when every setting matches, whatever the key order or the touch flags (must-keep)', () => {
  const reordered = { priorityChecks: { growth: true }, params: { '03_discovery_type': 'Deep', '00_business_name': 'Acme' }, electionTouched: true, discoveryTouched: true };
  assert.equal(sameSettings(form, reordered), true);
});

test('one changed setting, or one extra key, makes the form differ from its profile (must-fail)', () => {
  assert.equal(sameSettings(form, { ...form, params: { ...form.params, '03_discovery_type': 'Light' } }), false);
  assert.equal(sameSettings(form, { ...form, relationships: 'keep' }), false, 'a new key rides along, so it counts');
  assert.equal(sameSettings(form, { ...form, priorityChecks: {} }), false);
});

test('the download name is inspire_profile_<name>.json, with characters a file system refuses turned into dashes (must-exclude)', () => {
  assert.equal(profileFileName('Acme retail'), 'inspire_profile_Acme_retail.json');
  assert.equal(profileFileName('  a/b:c*d  '), 'inspire_profile_a-b-c-d.json');
  assert.equal(profileFileName(''), 'inspire_profile_profile.json');
});

test('the download file carries the name, who saved it, when, and the whole settings object', () => {
  const text = profileFileText({ name: 'Acme', business_name: 'Acme', saved_by: 'amr@example.com', saved_at: '2026-11-16T09:00:00Z', spec: form });
  assert.equal(text.endsWith('\n'), true);
  assert.deepEqual(JSON.parse(text), { format: 'inspire_profile', version: 1, name: 'Acme', business_name: 'Acme', saved_by: 'amr@example.com', saved_at: '2026-11-16T09:00:00Z', spec: form });
});
