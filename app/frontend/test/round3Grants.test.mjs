// REQ-131, REQ-260 round 3: every GRANT the person can act on is a Permission Required entry (the one copy path).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appReadsChoices, appReadsPermission, ownSchemaPickPermission } from '../src/lib/implementWizard.js';
import { discoverPermissionsOf } from '../src/lib/v130UseCase.js';

const READS = { tables: [{ table: 'main.s.orders', owner: 'data-eng', grants: ['GRANT SELECT ON TABLE `main`.`s`.`orders` TO `app-sp`', 'GRANT USE SCHEMA ON SCHEMA `main`.`s` TO `app-sp`'] }] };

test('the owner chooser carries the exact grant statements in Permission Required and no SQL copy path (must-keep / must-exclude)', () => {
  const copy = appReadsChoices(READS).find((c) => c.id === 'copy');
  assert.equal(copy.sql, undefined, 'no separate SQL copy path (REQ-260)');
  assert.deepEqual(copy.permissions[0].statements, ['GRANT SELECT ON TABLE `main`.`s`.`orders` TO `app-sp`', 'GRANT USE SCHEMA ON SCHEMA `main`.`s` TO `app-sp`']);
  assert.doesNotMatch(copy.label + copy.detail, /GRANT|SQL/);
  assert.equal(appReadsPermission({ tables: [] }), null, 'no grant, no entry');
});

test('picking Its own schema raises its CREATE SCHEMA entry; the build does not raise it on load (must-keep / must-exclude)', () => {
  const entry = { statements: ['GRANT CREATE SCHEMA ON CATALOG `main` TO `amr@x`'], principal: 'amr@x', why: 'why' };
  assert.equal(ownSchemaPickPermission('own', { permission: entry }), entry);
  assert.equal(ownSchemaPickPermission('inspire', { permission: entry }), null, 'picking the Inspire schema raises nothing');
  assert.equal(ownSchemaPickPermission('own', { place: 'inspire' }), null, 'no entry from the route, nothing to raise');
});

test('a Discover run hands its grants to the results page as Permission Required entries (must-keep / must-exclude)', () => {
  const entry = { statements: ['GRANT SELECT ON TABLE `main`.`s`.`c` TO `sp`'], principal: 'sp', why: 'why' };
  assert.deepEqual(discoverPermissionsOf({ data_access: { permissions: [entry] } }), [entry]);
  assert.deepEqual(discoverPermissionsOf({ data_access: { permissions: [{ statements: [] }] } }), [], 'an empty entry is not raised');
  assert.deepEqual(discoverPermissionsOf({ data_access: {} }), []);
});
