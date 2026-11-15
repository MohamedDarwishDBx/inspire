// REQ-311: Request for Access sends the person's own grants as the person, only where a destination is set, and says plainly when it cannot.
const test = require('node:test');
const assert = require('node:assert/strict');
const AR = require('../lib/accessRequest');

const WHO = 'signed-in@example.com';
const GRANTS = [
  `GRANT USE CATALOG ON CATALOG \`main\` TO \`${WHO}\``,
  `GRANT USE SCHEMA ON SCHEMA \`main\`.\`s\` TO \`${WHO}\``,
  `GRANT SELECT ON TABLE \`main\`.\`s\`.\`orders\` TO \`${WHO}\``,
];
const EMAIL_DEST = { destinations: [{ destination_id: 'owner@example.com', destination_type: 'EMAIL', special_destination: 'SPECIAL_DESTINATION_CATALOG_OWNER' }] };

// A fake of the one call the module makes. Each route answers from the table; every call is recorded.
function fakeCall(answers) {
  const calls = [];
  const call = async (path, opts = {}) => {
    calls.push({ path, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : undefined });
    const hit = answers[`${opts.method || 'GET'} ${path}`] || answers[path];
    if (typeof hit === 'function') return hit();
    return hit || { ok: false, status: 404, data: { message: `no fake for ${path}` } };
  };
  return { call, calls };
}

test('the person grants are read per securable, privileges once each, and only the person grants are requestable', () => {
  const got = AR.requestsOf([...GRANTS, 'GRANT SELECT ON TABLE `main`.`s`.`orders` TO `app-sp`', `GRANT CAN_USE ON WAREHOUSE \`w\` TO \`${WHO}\``], WHO);
  assert.deepEqual(got, [
    { securable: { type: 'CATALOG', full_name: 'main' }, permissions: ['USE_CATALOG'] },
    { securable: { type: 'SCHEMA', full_name: 'main.s' }, permissions: ['USE_SCHEMA'] },
    { securable: { type: 'TABLE', full_name: 'main.s.orders' }, permissions: ['SELECT'] },
  ]);
  assert.deepEqual(AR.requestsOf(GRANTS, 'someone.else@example.com'), []);
  assert.deepEqual(AR.requestsOf(GRANTS, ''), []);
});

test('success: destinations are read, then one request goes out as the person with no behalf_of, and the result names where it went', async () => {
  const { call, calls } = fakeCall({
    'GET /api/3.0/rfa/destinations/catalog/main': { ok: true, status: 200, data: EMAIL_DEST },
    'GET /api/3.0/rfa/destinations/schema/main.s': { ok: true, status: 200, data: EMAIL_DEST },
    'GET /api/3.0/rfa/destinations/table/main.s.orders': { ok: true, status: 200, data: EMAIL_DEST },
    'POST /api/3.0/rfa/requests': { ok: true, status: 200, data: { responses: [] } },
  });
  const got = await AR.sendAccessRequest({ call, who: WHO, statements: GRANTS });
  assert.deepEqual(got, { sent: true, destinations: ['owner@example.com'], reason: '' });
  const post = calls.find((c) => c.method === 'POST');
  assert.equal(post.path, '/api/3.0/rfa/requests');
  assert.equal(post.body.requests.length, 1);
  assert.equal(Object.hasOwn(post.body.requests[0], 'behalf_of'), false, 'no behalf_of: the requester is the signed-in person');
  assert.equal(post.body.requests[0].comment, AR.COMMENT);
  assert.ok(AR.COMMENT.length <= 200 && /^[A-Za-z0-9 .,'!?-]+$/.test(AR.COMMENT), 'the comment fits the API rule');
  assert.deepEqual(post.body.requests[0].securable_permissions.map((p) => p.securable.full_name), ['main', 'main.s', 'main.s.orders']);
});

test('no destination set: the check says not offered with a plain reason, and no request is sent', async () => {
  const { call, calls } = fakeCall({
    'GET /api/3.0/rfa/destinations/catalog/main': { ok: true, status: 200, data: {} },
    'GET /api/3.0/rfa/destinations/schema/main.s': { ok: true, status: 200, data: {} },
    'GET /api/3.0/rfa/destinations/table/main.s.orders': { ok: true, status: 200, data: {} },
  });
  const check = await AR.checkAccessRequest({ call, who: WHO, statements: GRANTS });
  assert.deepEqual(check, { offered: false, destinations: [], reason: AR.NO_DESTINATION, pending: [] });
  const sent = await AR.sendAccessRequest({ call, who: WHO, statements: GRANTS });
  assert.equal(sent.sent, false);
  assert.equal(sent.reason, check.reason);
  assert.equal(calls.some((c) => c.method === 'POST'), false, 'nothing is posted where no destination is set');
});

test('denied: the workspace refuses the request, and the refusal is the reason', async () => {
  const { call } = fakeCall({
    'GET /api/3.0/rfa/destinations/catalog/main': { ok: true, status: 200, data: EMAIL_DEST },
    'GET /api/3.0/rfa/destinations/schema/main.s': { ok: true, status: 200, data: EMAIL_DEST },
    'GET /api/3.0/rfa/destinations/table/main.s.orders': { ok: true, status: 200, data: EMAIL_DEST },
    'POST /api/3.0/rfa/requests': { ok: false, status: 403, data: { message: 'PERMISSION_DENIED: you cannot request this securable' } },
  });
  const got = await AR.sendAccessRequest({ call, who: WHO, statements: GRANTS });
  assert.deepEqual(got, { sent: false, destinations: [], reason: 'PERMISSION_DENIED: you cannot request this securable' });
});

test('the API is unreachable for this App (missing scope): the check is not offered and the workspace message is kept', async () => {
  const scopeMessage = "Provided OAuth token does not have required scopes: 'unity-catalog'";
  const { call } = fakeCall({
    'GET /api/3.0/rfa/destinations/catalog/main': { ok: false, status: 403, data: { message: scopeMessage } },
    'GET /api/3.0/rfa/destinations/schema/main.s': { ok: false, status: 403, data: { message: scopeMessage } },
    'GET /api/3.0/rfa/destinations/table/main.s.orders': { ok: false, status: 403, data: { message: scopeMessage } },
  });
  const check = await AR.checkAccessRequest({ call, who: WHO, statements: GRANTS });
  assert.equal(check.offered, false);
  assert.equal(check.reason, scopeMessage);
});

test('a grant to another principal is never sent as the person, and no call is made for it', async () => {
  const { call, calls } = fakeCall({});
  const other = ['GRANT SELECT ON TABLE `main`.`s`.`orders` TO `11111111-2222-3333-4444-555555555555`'];
  const check = await AR.checkAccessRequest({ call, who: WHO, statements: other });
  assert.equal(check.offered, false);
  assert.equal(check.reason, 'none of these grants can be requested through Request for Access');
  assert.equal(calls.length, 0);
});

test('no signed-in person: nothing is read or sent, and the reason says so', async () => {
  const { call, calls } = fakeCall({});
  const got = await AR.sendAccessRequest({ call, who: '', statements: GRANTS });
  assert.equal(got.sent, false);
  assert.match(got.reason, /cannot tell who is signed in/);
  assert.equal(calls.length, 0);
});

test('a destination with no address names the owner of the securable', () => {
  assert.equal(AR.destinationLabel({ special_destination: 'SPECIAL_DESTINATION_SCHEMA_OWNER' }, { type: 'SCHEMA', full_name: 'main.s' }), 'the owner of schema main.s');
  assert.equal(AR.destinationLabel({ destination_id: 'a@b.c' }, { type: 'TABLE', full_name: 'x' }), 'a@b.c');
});
