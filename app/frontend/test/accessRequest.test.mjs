// REQ-311: the Permission Required dialog offers Request access only when the check finds a destination, and a sent or refused request
// reads as one plain line. Both calls go to the App's own routes with the dialog's statements.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accessRequestResultText, checkAccessRequest, offerShown, sendAccessRequest, statementsOf,
} from '../src/lib/accessRequest.js';

const STATEMENTS = ['GRANT SELECT ON TABLE `main`.`s`.`orders` TO `signed-in@example.com`;'];

function withFetch(answer, fn) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined });
    return answer(url);
  };
  return fn(calls).finally(() => { globalThis.fetch = real; });
}

test('the button is offered only when the check says a destination is set', () => {
  assert.equal(offerShown(null), false, 'no check yet: no button');
  assert.equal(offerShown({ offered: false, reason: 'no one has set up where access requests for these go yet' }), false);
  assert.equal(offerShown({ offered: true, destinations: ['owner@example.com'] }), true);
  assert.equal(offerShown({ offered: 'yes' }), false, 'only the boolean true offers it');
});

test('the result line names where the request went, or the plain reason it was not sent', () => {
  assert.equal(accessRequestResultText({ sent: true, destinations: ['owner@example.com'] }), 'Request sent to owner@example.com');
  assert.equal(accessRequestResultText({ sent: true, destinations: ['a@x.com', 'b@x.com'] }), 'Request sent to a@x.com, b@x.com');
  assert.equal(accessRequestResultText({ sent: true, destinations: [] }), 'Request sent');
  assert.equal(accessRequestResultText({ sent: false, reason: 'PERMISSION_DENIED: you cannot request this' }), 'Request not sent: PERMISSION_DENIED: you cannot request this');
  assert.equal(accessRequestResultText({ sent: false, reason: '' }), 'Request not sent');
  assert.equal(accessRequestResultText(null), '');
});

test('the dialog statements are flattened in their order, and a permission with none adds nothing', () => {
  assert.deepEqual(statementsOf([{ statements: ['a;', 'b;'] }, {}, null, { statements: ['c;'] }]), ['a;', 'b;', 'c;']);
  assert.deepEqual(statementsOf(undefined), []);
});

test('the check posts the dialog statements to the App route and reads the offer back', async () => {
  await withFetch(() => new Response(JSON.stringify({ offered: true, destinations: ['owner@example.com'], reason: '' }), { status: 200, headers: { 'Content-Type': 'application/json' } }), async (calls) => {
    const got = await checkAccessRequest(STATEMENTS);
    assert.deepEqual(got, { offered: true, destinations: ['owner@example.com'], reason: '' });
    assert.deepEqual(calls, [{ url: '/api/access-request/check', method: 'POST', body: { statements: STATEMENTS } }]);
  });
});

test('the send posts to the App route and reads the sent result back', async () => {
  await withFetch(() => new Response(JSON.stringify({ sent: true, destinations: ['owner@example.com'], reason: '' }), { status: 200, headers: { 'Content-Type': 'application/json' } }), async (calls) => {
    const got = await sendAccessRequest(STATEMENTS);
    assert.equal(got.sent, true);
    assert.deepEqual(calls.map((c) => [c.url, c.method]), [['/api/access-request', 'POST']]);
  });
});

test('a refused check rejects to the caller and never opens the App-level dialog over itself', async () => {
  await withFetch(() => new Response(JSON.stringify({ error: 'the workspace answered 403' }), { status: 403, headers: { 'Content-Type': 'application/json' } }), async () => {
    await assert.rejects(() => checkAccessRequest(STATEMENTS));
  });
});
