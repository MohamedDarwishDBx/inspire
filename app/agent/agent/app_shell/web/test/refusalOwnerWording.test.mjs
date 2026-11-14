import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAILURE_CAUSES } from '../src/failureCauses.js';
import { ASK_OWNER_APP_TEXT, ASK_OWNER_TEXT, setFailureCauses, splitTechnical } from '../src/plainText.js';

// REQ-041: a refused data read says "your data owner" (never "its owner" or "the owner"), and keeps
// "a workspace admin" as the other person to ask. The grant SQL stays under Details.
setFailureCauses(FAILURE_CAUSES);

const DENIED_OBJECT = '[INSUFFICIENT_PERMISSIONS] Insufficient privileges: User does not have SELECT on Table `main`.`sales`.`loss`. SQLSTATE: 42501';
const DENIED_NO_OBJECT = 'PERMISSION_DENIED: User cannot view run 777';
const DENIED_GRANT = 'PERMISSION_DENIED: User does not have USE SCHEMA on Schema main._inspire. Ask the owner to run: GRANT USE SCHEMA ON SCHEMA main._inspire TO `someone@example.com`';

test('a refused table read asks your data owner or a workspace admin, and names no "its owner"', () => {
  const { plain, details } = splitTechnical(DENIED_OBJECT);
  assert.equal(plain, 'Access to table main.sales.loss was refused, so ask your data owner or a workspace admin to give you access.');
  assert.ok(!/\bits owner\b|\bthe owner\b/.test(plain), plain);
  assert.equal(details.length, 1, 'the raw error stays under Details');
});

test('a refused read with no table named asks your data owner or a workspace admin', () => {
  const { plain } = splitTechnical(DENIED_NO_OBJECT);
  assert.equal(plain, 'User cannot view run 777, so ask your data owner or a workspace admin to give you access.');
});

test('the grant sentence says your data owner for a person, and the App line says it too', () => {
  assert.equal(ASK_OWNER_TEXT, 'Ask your data owner to give you the access listed under Details');
  assert.equal(ASK_OWNER_APP_TEXT, 'Ask your data owner to give the App the access listed under Details');
  const { plain, details } = splitTechnical(DENIED_GRANT);
  assert.equal(plain, 'User does not have USE SCHEMA on Schema main._inspire. Ask your data owner to give you the access listed under Details');
  assert.deepEqual(details, ['GRANT USE SCHEMA ON SCHEMA main._inspire TO `someone@example.com`', 'PERMISSION_DENIED']);
});

test('a stopped SQL warehouse keeps its own owner: the warehouse owner is compute, not data', () => {
  const { plain } = splitTechnical('The SQL warehouse is stopped');
  assert.match(plain, /ask its owner to, then try again\.$/);
});

// The securable is the object kind the caller already knows. Data denials keep the data owner; compute and workspace
// denials name the workspace admin, because a warehouse, job run or folder has no data owner to ask.
const WAREHOUSE_LIST = 'PERMISSION_DENIED: User is not allowed to list SQL warehouses.';
const JOB_RUN = 'PERMISSION_DENIED: User cannot view job run 777';

test('a refused SQL warehouse list asks your workspace admin, never the data owner', () => {
  const { plain, details } = splitTechnical(WAREHOUSE_LIST, { securable: 'compute' });
  assert.equal(plain, 'User is not allowed to list SQL warehouses, so ask your workspace admin to give you access.');
  assert.ok(!/data owner/.test(plain), plain);
  assert.equal(details.length, 1, 'the raw error stays under Details');
});

test('a refused job run read asks your workspace admin, never the data owner', () => {
  const { plain } = splitTechnical(JOB_RUN, { securable: 'workspace' });
  assert.equal(plain, 'User cannot view job run 777, so ask your workspace admin to give you access.');
});

test('the same refusal with no securable, or a data securable, still asks your data owner', () => {
  const data = 'User cannot view job run 777, so ask your data owner or a workspace admin to give you access.';
  assert.equal(splitTechnical(JOB_RUN).plain, data);
  assert.equal(splitTechnical(JOB_RUN, { securable: 'data' }).plain, data);
  assert.equal(splitTechnical(WAREHOUSE_LIST, { securable: 'data' }).plain,
    'User is not allowed to list SQL warehouses, so ask your data owner or a workspace admin to give you access.');
});
