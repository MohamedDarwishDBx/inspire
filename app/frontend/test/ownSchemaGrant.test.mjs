// REQ-131, REQ-137, REQ-260: the CREATE SCHEMA grant the own-schema note names reaches the Permission Required dialog as statements,
// and the note itself carries no GRANT text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownSchemaFallbackNote, ownSchemaGrantPermission } from '../src/lib/implementWizard.js';
import { resultPlaceBlocks } from '../src/lib/recommended.js';

test('the own-schema grant is the dialog payload: its statement is the full GRANT, the principal is the person (must-keep)', () => {
  const p = ownSchemaGrantPermission('main', 'owner@example.com');
  assert.deepEqual(p.statements, ['GRANT CREATE SCHEMA ON CATALOG `main` TO `owner@example.com`']);
  assert.equal(p.principal, 'owner@example.com');
  assert.match(p.why, /main/);
  assert.equal(ownSchemaGrantPermission('main', '').statements[0], 'GRANT CREATE SCHEMA ON CATALOG `main` TO <you>');
});

test('the own-schema note and the result place block carry no GRANT text, and name the dialog (must-exclude GRANT in prose)', () => {
  const note = ownSchemaFallbackNote('main', 'owner@example.com');
  assert.doesNotMatch(note, /GRANT/);
  assert.match(note, /CREATE SCHEMA on main/);
  assert.match(note, /Permission Required/);
  const blocks = resultPlaceBlocks({ place: 'inspire' }, 'main.sales.out', 'main.inspire.out', 'main');
  assert.doesNotMatch(JSON.stringify(blocks), /GRANT/);
  assert.match(blocks.own.details, /Permission Required/);
});
