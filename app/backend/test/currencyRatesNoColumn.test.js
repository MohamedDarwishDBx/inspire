// REQ-103 (screen 9 "Report the amounts"): a use case table with no currency column reads the rate of the one code its value is written in.
// The route takes that code list and reads no table; with neither a currency column nor a code it refuses with the reason.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

const ORDERS = 'main.s.orders';
const BODY = { inspire_database: 'main.inspire', session_id: '42', use_case_id: 'N01-U01', warehouse_id: 'wh1' };

async function post(made, route, body) {
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: resp.status, data: await resp.json() };
  } finally {
    await srv.close();
  }
}

test('a table with no currency column reads the rate of the value code, with no table read (REQ-103)', async () => {
  const made = makeApp({ forwardedToken: 'person-tok' });
  const got = await post(made, '/api/money/currency-rates', { ...BODY, table: ORDERS, codes: ['usd'], base: 'AED' });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.deepEqual(got.data.currencies, [{ code: 'USD', records: null }], 'the one code the value is written in is the only currency');
  assert.equal(got.data.base, 'AED', 'the reporting currency asked for is the base of the rates');
  assert.ok(!made.sqlCalls.some((c) => c.sql.includes(ORDERS)), 'no statement reads the use case table (must-exclude)');
});

test('a table with no currency column and no value code is refused with the reason, before any read (REQ-103)', async () => {
  const made = makeApp({ forwardedToken: 'person-tok' });
  const got = await post(made, '/api/money/currency-rates', { ...BODY, table: ORDERS });
  assert.equal(got.status, 400);
  assert.match(JSON.stringify(got.data), /Name the currency the value is written in/);
  assert.equal(made.sqlCalls.length, 0, 'no statement runs');
});
