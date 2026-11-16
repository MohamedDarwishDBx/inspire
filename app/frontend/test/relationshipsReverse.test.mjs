import test from 'node:test';
import assert from 'node:assert/strict';
import { restoredRelationshipList, sameLink } from '../src/lib/tableRelationships.js';

// REQ-394: A.col -> B.col and B.col -> A.col are one join. A link is the same link in either direction.
const ORDERS_CUSTOMER = { from: { table: 'main.s.orders', column: 'customer_id' }, to: { table: 'main.s.customers', column: 'customer_id' }, source: 'person' };
const CUSTOMERS_CUSTOMER = { from: { table: 'main.s.customers', column: 'customer_id' }, to: { table: 'main.s.orders', column: 'customer_id' }, source: 'person' };
const ORDERS_AMOUNT = { from: { table: 'main.s.orders', column: 'amount' }, to: { table: 'main.s.customers', column: 'customer_id' }, source: 'person' };

test('a link and its reverse are the same link (REQ-394)', () => {
  assert.equal(sameLink(ORDERS_CUSTOMER, CUSTOMERS_CUSTOMER), true, 'the reverse is a duplicate');
  assert.equal(sameLink(ORDERS_CUSTOMER, { ...ORDERS_CUSTOMER }), true, 'an exact duplicate is a duplicate');
});

test('two links that join different columns are not the same link (REQ-394 must-exclude)', () => {
  assert.equal(sameLink(ORDERS_CUSTOMER, ORDERS_AMOUNT), false);
  const sameTableOtherColumn = { ...CUSTOMERS_CUSTOMER, to: { table: 'main.s.orders', column: 'amount' } };
  assert.equal(sameLink(ORDERS_CUSTOMER, sameTableOtherColumn), false, 'the same tables with other columns is a new join');
});

test('a saved profile with both directions restores one link, the first kept (REQ-394)', () => {
  const saved = [ORDERS_CUSTOMER, CUSTOMERS_CUSTOMER, ORDERS_AMOUNT].map(({ from, to, source }) => ({ from, to, source }));
  assert.deepEqual(restoredRelationshipList(saved), [
    { from: ORDERS_CUSTOMER.from, to: ORDERS_CUSTOMER.to, source: 'person' },
    { from: ORDERS_AMOUNT.from, to: ORDERS_AMOUNT.to, source: 'person' },
  ]);
});

test('a restored list drops entries that are not links and keeps a valid list as it is (REQ-394)', () => {
  assert.deepEqual(restoredRelationshipList(null), []);
  assert.deepEqual(restoredRelationshipList([{ from: { table: 'main.s.orders' }, to: ORDERS_CUSTOMER.to, source: 'person' }]), []);
  assert.deepEqual(restoredRelationshipList([ORDERS_CUSTOMER]), [{ from: ORDERS_CUSTOMER.from, to: ORDERS_CUSTOMER.to, source: 'person' }]);
});
