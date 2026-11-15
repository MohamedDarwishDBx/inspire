// REQ-216, REQ-131: an optional grant is labelled optional in the dialog and never says it is needed first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { grantAsk } from '../src/lib/permissionBus.js';

test('an optional grant is labelled optional, not as a grant the person needs first', () => {
  const line = grantAsk({ statements: ['GRANT CREATE ON DATABASE `databricks_postgres` TO `app-sp`;'], optional: true, principal: 'app-sp' });
  assert.equal(line, 'Optional: pages load faster once your admin runs this.');
  assert.doesNotMatch(line, /Ask your admin|needs this grant/);
});

// REQ-300: a required grant is a short heading for its grantee, not the repeated Ask your admin sentence.
test('a required grant has a short heading with its principal', () => {
  assert.equal(grantAsk({ statements: ['GRANT SELECT ON TABLE `main`.`s`.`orders` TO `app-sp`;'], principal: 'app-sp' }), 'For app-sp');
  assert.equal(grantAsk({ statements: [] }), 'For your admin');
});
