// REQ-316 / REQ-126: the use case label names the Row Groups of the picked tables, so it is available only when a picked table has
// a Row Group. labelAvailable is the one rule: the Launch box is disabled without it, and the serialiser writes use_case_label only with it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { labelAvailable, serializeTableScopes } from '../src/lib/tableScope.js';

const T = 'main.s.orders';
const OTHER = 'main.s.other';
const FILTER = { column: 'brand_name', op: '=', values: ['Starbucks'] };
const GROUP = { column: 'brand_name', op: 'in', values: ['Starbucks'], group: true };
const scopesOf = (table, ...rows) => ({ [table]: { columns: ['brand_name'], rows } });

test('no picked table has a Row Group: the label is not available, and a plain row filter does not count', () => {
  assert.equal(labelAvailable(scopesOf(T), [T]), false, 'a table with no rows');
  assert.equal(labelAvailable(scopesOf(T, FILTER), [T]), false, 'a row filter alone');
});

test('a Row Group on a picked table makes the label available', () => {
  assert.equal(labelAvailable(scopesOf(T, FILTER, GROUP), [T]), true);
});

test('a Row Group on a table that is not picked does not make the label available', () => {
  assert.equal(labelAvailable(scopesOf(OTHER, GROUP), [T]), false);
});

test('the serialiser writes use_case_label exactly when labelAvailable holds', () => {
  const on = JSON.parse(serializeTableScopes(scopesOf(T, GROUP), [T], 'Starbucks Cafe'));
  assert.equal(on.use_case_label, 'Starbucks Cafe');
  assert.deepEqual(on[T].rows, [GROUP]);

  const filterOnly = JSON.parse(serializeTableScopes(scopesOf(T, FILTER), [T], 'Starbucks Cafe'));
  assert.equal('use_case_label' in filterOnly, false, 'a row filter alone: the label is dropped, the scope is kept');
  assert.equal(filterOnly[T].rows.length, 1);

  const noRows = JSON.parse(serializeTableScopes(scopesOf(T), [T], 'Starbucks Cafe'));
  assert.equal('use_case_label' in noRows, false, 'a table with no Row Group: the label is dropped, the column pick is kept');
  assert.equal(serializeTableScopes({}, [T], 'Starbucks Cafe'), '', 'no scope at all: nothing is sent');
});

test('the group on an unpicked table does not carry the label, so the label is not written for a table the run does not read', () => {
  assert.equal(serializeTableScopes(scopesOf(OTHER, GROUP), [T], 'Starbucks Cafe'), '');
});

test('removing the Row Group drops the label from the text, and adding it back restores the label from the same typed text', () => {
  assert.equal('use_case_label' in JSON.parse(serializeTableScopes(scopesOf(T, FILTER), [T], 'Starbucks Cafe')), false);
  const back = JSON.parse(serializeTableScopes(scopesOf(T, GROUP), [T], 'Starbucks Cafe'));
  assert.equal(back.use_case_label, 'Starbucks Cafe');
});
