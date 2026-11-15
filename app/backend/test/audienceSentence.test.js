// WH (rc7 Build): the Permission Required sentence for an audience names a group as a group and a person as themselves (REQ-131, REQ-226).
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/inspireImplement');

test('a group reads as People in <group> open the App (must-keep)', () => {
  assert.equal(I.opensAppSentence('admins', 'inspire-walk-rc2-planning'),
    'People in admins open the App inspire-walk-rc2-planning and read its data with their own access, so they need these grants.');
});

test('one person reads as their own name, never as a group (must-keep)', () => {
  assert.equal(I.opensAppSentence('new.viewer@x', 'riverside-assets'),
    'new.viewer@x opens the App riverside-assets and reads its data with their own access, so they need these grants.');
});

test('a group is never written as "<group> opens" (must-exclude)', () => {
  assert.doesNotMatch(I.opensAppSentence('admins', 'riverside-assets'), /^admins opens/);
  assert.doesNotMatch(I.opensAppSentence('data-eng', ''), /^data-eng opens/);
});
