import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewAlert, WAITING_FOR_ACCESS_CODE } from '../src/api.js';

// REQ-313: a write the warehouse refuses answers 403 with the waiting state, and the client opens the same dialog a read opens.
const WAITING = { state: 'waiting_for_access', message: 'waiting', tables: ['main.s.orders'], owners: [], detail: 'denied',
  permissions: [{ statements: ['GRANT SELECT ON TABLE `main`.`s`.`orders` TO `amr@example.com`'], principal: 'amr@example.com' }] };
const realFetch = globalThis.fetch;
const answer = (status, body) => { globalThis.fetch = async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); };

test('a refused write with the waiting state throws the waiting error, so the dialog opens (REQ-313)', async () => {
  answer(403, WAITING);
  try {
    await previewAlert({ watch: {} });
    assert.fail('expected the waiting error');
  } catch (error) {
    assert.equal(error.code, WAITING_FOR_ACCESS_CODE);
    assert.deepEqual(error.detail.permissions, WAITING.permissions);
    assert.equal(error.calm, true);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('must-exclude: a refused write with no waiting state stays a plain error, with no dialog (must-exclude)', async () => {
  answer(403, { error: 'only the owner can change it' });
  try {
    await previewAlert({ watch: {} });
    assert.fail('expected an error');
  } catch (error) {
    assert.notEqual(error.code, WAITING_FOR_ACCESS_CODE);
    assert.equal(error.message, 'only the owner can change it');
  } finally {
    globalThis.fetch = realFetch;
  }
});
