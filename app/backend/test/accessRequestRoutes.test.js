// REQ-311: the two Request for Access routes, driven through the registered App. The check reads the destinations with the person's own
// token; nothing is sent when no destination is set; the send needs a signed-in person.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');

const WHO = 'nonowner@example.com';
const GRANTS = [`GRANT SELECT ON TABLE \`main\`.\`s\`.\`orders\` TO \`${WHO}\``];

test.after(() => S.stopServer());

test('a signed-in person checks Request for Access with their own token, and nothing is posted when no destination is set', async () => {
  S.reset();
  const got = await S.request('POST', '/api/access-request/check', { person: WHO, body: { statements: GRANTS } });
  assert.equal(got.status, 200, got.text);
  assert.equal(got.data.offered, false, 'no destination set in the fake workspace');
  const reads = S.state.calls.filter((c) => c.path.startsWith('/api/3.0/rfa/destinations/'));
  assert.ok(reads.length > 0, 'the destination of the table was read');
  assert.deepEqual([...new Set(reads.map((c) => c.token))], [S.PERSON_TOKEN], 'read as the person, never as the App');
  assert.equal(S.state.calls.some((c) => c.method === 'POST' && c.path === '/api/3.0/rfa/requests'), false);
});

test('the send route makes no request when the signed-in person has no token, and the App never sends one for a person', async () => {
  S.reset();
  const got = await S.request('POST', '/api/access-request', { person: WHO, signedIn: false, body: { statements: GRANTS } });
  assert.notEqual(got.status, 500, got.text);
  assert.equal(S.state.calls.some((c) => c.method === 'POST' && c.path === '/api/3.0/rfa/requests'), false);
});
