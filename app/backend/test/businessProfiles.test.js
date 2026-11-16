const test = require('node:test');
const assert = require('node:assert/strict');
const BP = require('../lib/businessProfiles');

const spec = { version: 1, params: { '00_business_name': 'Acme' }, tableScopes: {} };

test('a save needs a name, a settings object and a name of at most 120 characters (must-fail)', () => {
  assert.deepEqual(BP.profileToSave({ name: '   ', spec }), { error: 'Give the profile a name' });
  assert.deepEqual(BP.profileToSave({ name: 'Acme', spec: 'x' }), { error: 'The profile needs the settings of the form' });
  assert.deepEqual(BP.profileToSave({ name: 'Acme', spec: [] }), { error: 'The profile needs the settings of the form' });
  assert.match(BP.profileToSave({ name: 'x'.repeat(BP.NAME_MAX + 1), spec }).error, /at most 120 characters/);
  assert.equal(BP.profileToSave({ name: 'x'.repeat(BP.NAME_MAX), spec }).error, undefined);
  assert.match(BP.profileToSave({ name: 'Acme', spec: { big: 'x'.repeat(200001) } }).error, /too large/);
});

test('a save trims and collapses the name, takes the business name from the form when none is sent, and keeps the whole spec', () => {
  const saved = BP.profileToSave({ name: '  Acme   retail  ', spec, overwrite: true });
  assert.equal(saved.name, 'Acme retail');
  assert.equal(saved.businessName, 'Acme', 'the business name comes from the form');
  assert.equal(saved.overwrite, true);
  assert.deepEqual(JSON.parse(saved.specJson), spec, 'every key of the form rides along, new keys included');
  assert.equal(BP.profileToSave({ name: 'a', business_name: ' Beta ', spec }).businessName, 'Beta');
  assert.equal(BP.profileToSave({ name: 'a', spec }).overwrite, false, 'overwrite is off unless the save asks for it (must-exclude)');
});

test('profile ids are the ids Inspire gives out; anything else is refused before it reaches SQL (must-fail)', () => {
  assert.equal(BP.isProfileId('3f2a9c1e-8b7d-4e6f-9a0b-1c2d3e4f5a6b'), true);
  for (const bad of ['', 'a b', "x' OR 1=1 --", 'x'.repeat(65), null]) assert.equal(BP.isProfileId(bad), false, String(bad));
  assert.equal(BP.getStatement('`c`.`s`.`t`', "x' OR 1=1 --"), null);
});

test('the profile tables live in the App database and their names are quoted like the launch record', () => {
  assert.equal(BP.profilesTable('Main.Inspire'), '`Main`.`Inspire`.`__inspire_profile`');
  assert.equal(BP.linksTable('Main.Inspire'), '`Main`.`Inspire`.`__inspire_profile_link`');
  assert.equal(BP.profilesTable(''), null);
  assert.equal(BP.linksTable('a.b.c'), null);
});

test('the list filters by business name case-insensitively and takes the newest profiles first', () => {
  const all = BP.listStatement('T', '');
  assert.doesNotMatch(all.sql, /WHERE/);
  assert.match(all.sql, /ORDER BY updated_at DESC LIMIT 200$/);
  assert.deepEqual(all.parameters, []);
  const one = BP.listStatement('T', '  Acme ');
  assert.match(one.sql, /WHERE lower\(business_name\) = lower\(:business_name\)/);
  assert.deepEqual(one.parameters.map((p) => [p.name, p.value]), [['business_name', 'Acme']]);
});

test('an insert and an overwrite carry the same values; the overwrite keeps the row and moves the saver and the time', () => {
  const values = { profileId: 'p1', name: 'Acme', businessName: 'Acme', specJson: '{}', by: 'amr@example.com' };
  const insert = BP.insertStatement('T', values);
  assert.match(insert.sql, /^INSERT INTO T \(profile_id, name, business_name, spec_json, created_by, created_at, updated_by, updated_at\)/);
  assert.deepEqual(insert.parameters.map((p) => [p.name, p.value]), [['profile_id', 'p1'], ['name', 'Acme'], ['business_name', 'Acme'], ['spec_json', '{}'], ['by', 'amr@example.com']]);
  const overwrite = BP.overwriteStatement('T', values);
  assert.match(overwrite.sql, /^UPDATE T SET name = :name, business_name = :business_name, spec_json = :spec_json, updated_by = :by, updated_at = current_timestamp\(\) WHERE profile_id = :profile_id$/);
});

test('the summary names who saved the profile last and when, and the detail parses the spec (a bad spec reads as empty, never throws)', () => {
  const row = { profile_id: 'p1', name: 'Acme', business_name: 'Acme', created_by: 'a@x', created_at: 't1', updated_by: 'b@x', updated_at: 't2', spec_json: '{"params":{"00_business_name":"Acme"}}' };
  assert.deepEqual(BP.profileSummary(row), { profile_id: 'p1', name: 'Acme', business_name: 'Acme', updated_by: 'b@x', updated_at: 't2' });
  assert.deepEqual(BP.profileSummary({ ...row, updated_by: null, updated_at: null }), { profile_id: 'p1', name: 'Acme', business_name: 'Acme', updated_by: 'a@x', updated_at: 't1' });
  assert.deepEqual(BP.profileDetail(row).spec, { params: { '00_business_name': 'Acme' } });
  assert.deepEqual(BP.profileDetail({ ...row, spec_json: '{not json' }).spec, {}, 'a corrupt spec reads as no settings, the save never wrote it');
  assert.deepEqual(BP.profileDetail({ ...row, spec_json: '[1,2]' }).spec, {}, 'a spec that is not an object reads as no settings');
});

test('a session takes the profile of its newest link only; a session with no link keeps no profile fields (must-exclude)', () => {
  const sessions = [{ session_id: '7', business_name: 'Acme' }, { session_id: '8' }];
  const rows = [
    { session_id: '7', profile_id: 'p2', profile_name: 'Newest' },
    { session_id: '7', profile_id: 'p1', profile_name: 'Older' },
  ];
  BP.withProfiles(sessions, rows);
  assert.deepEqual(sessions[0], { session_id: '7', business_name: 'Acme', profile_id: 'p2', profile_name: 'Newest' });
  assert.equal(Object.hasOwn(sessions[1], 'profile_name'), false);
});

test('the links query names the session ids it asks for and nothing when none are listed', () => {
  assert.equal(BP.linksOfSessionsStatement('L', 'P', 'Main.Inspire', []), null);
  const st = BP.linksOfSessionsStatement('L', 'P', ' Main.Inspire ', ['7', '7', '8']);
  assert.match(st.sql, /AS profile_name FROM L l JOIN P p ON p\.profile_id = l\.profile_id/);
  assert.match(st.sql, /IN \(:s0, :s1\) ORDER BY l\.linked_at DESC$/);
  assert.deepEqual(st.parameters.map((p) => p.value), ['main.inspire', '7', '8']);
});

test('a link row names the run session, the database and the saver', () => {
  const st = BP.linkInsertStatement('L', { inspireDatabase: 'Main.Inspire', sessionId: '7001', profileId: 'p1', by: 'amr@example.com' });
  assert.match(st.sql, /^INSERT INTO L \(session_id, inspire_database, profile_id, linked_by, linked_at\)/);
  assert.deepEqual(st.parameters.map((p) => [p.name, p.value]), [['session_id', '7001'], ['inspire_database', 'main.inspire'], ['profile_id', 'p1'], ['by', 'amr@example.com']]);
});

test('openapi.yaml documents the three profile routes the server registers, with their refusal codes (must-fail before the doc existed)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const yaml = require('js-yaml');
  const doc = yaml.load(fs.readFileSync(path.join(__dirname, '..', 'openapi.yaml'), 'utf8'));
  const ops = (route) => Object.keys(doc.paths[route] || {}).sort();
  assert.deepEqual(ops('/api/inspire/profiles'), ['get', 'post']);
  assert.deepEqual(ops('/api/inspire/profiles/{profileId}'), ['get']);
  assert.deepEqual(Object.keys(doc.paths['/api/inspire/profiles'].post.responses).sort(), ['200', '400', '401', '409', '503']);
  assert.deepEqual(Object.keys(doc.paths['/api/inspire/profiles/{profileId}'].get.responses).sort(), ['200', '400', '401', '404', '503']);
  assert.ok(doc.components.schemas.BusinessProfileSummary, 'the summary schema exists');
});
