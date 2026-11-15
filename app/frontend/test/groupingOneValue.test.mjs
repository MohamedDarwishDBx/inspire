// REQ-263 round 2: a Grouping column that holds one value in the Launch scope makes one group. The Data groups step says so in plain
// words and offers Whole data. A column with several values, or no column at all (Whole data), says nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { groupingOneValueColumns, groupingOneValueText } from '../src/lib/runScope.js';

const profile = {
  columns: [{ name: 'product', distinct: 1 }, { name: 'paymentMethod', distinct: 4 }],
};

test('a chosen column that holds one value in scope is named, with the plain reason', () => {
  const picked = { value: 'product', columns: ['product'] };
  assert.deepEqual(groupingOneValueColumns(picked, profile), ['product']);
  assert.equal(groupingOneValueText(picked, profile), 'product has one value in this data, so it makes one group. Pick Whole data as one group or another column.');
});

test('a column with several values, or Whole data, says nothing', () => {
  assert.equal(groupingOneValueText({ value: 'paymentMethod', columns: ['paymentMethod'] }, profile), '');
  assert.equal(groupingOneValueText({ value: 'all', columns: [] }, profile), '');
  assert.equal(groupingOneValueText(null, profile), '');
});

test('only the columns that hold one value are named when several are chosen', () => {
  const picked = { value: 'product, paymentMethod', columns: ['product', 'paymentMethod'] };
  assert.deepEqual(groupingOneValueColumns(picked, profile), ['product']);
});
