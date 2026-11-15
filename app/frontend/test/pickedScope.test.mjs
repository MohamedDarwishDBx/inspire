// v1.5.3-rc.1 (customer polish): 01_uc_metadata holds exactly what the person picked. A table picked from a schema is read
// alone; a parent is read whole only when no table under it was picked; a removed parent never takes a picked table with it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickedScope, wholeCatalogsAfterChildRemoval } from '../src/lib/catalogList.js';

const T = 'inspire_kinds_rc7._inspire.sales_transactions';
const C = 'inspire_kinds_rc7';
const S = 'inspire_kinds_rc7._inspire';

test('picking a table under a picked schema reads only that table, with its schema and catalog chips still on', () => {
  assert.deepEqual(pickedScope([C], [S], [T]).entries, [T]);
});

test('a schema with no picked table is read whole, and a catalog with no picked schema is read whole', () => {
  assert.deepEqual(pickedScope([C], [S], []).entries, [S]);
  assert.deepEqual(pickedScope([C], [], []).entries, [C]);
});

test('removing the schema chip keeps the table the person picked, so the scope is the table and not the catalog', () => {
  assert.deepEqual(pickedScope([C], [], [T]).entries, [T]);
});

test('removing the catalog chip keeps a picked table, and a catalog that holds a picked table is not read whole', () => {
  assert.deepEqual(pickedScope([], [], [T]).entries, [T]);
  assert.deepEqual(pickedScope([C], [], [T]).entries, [T]);
});

test('a catalog listed but not whole reads nothing under it, so an opened catalog with nothing picked is not the whole catalog (must-exclude)', () => {
  assert.deepEqual(pickedScope([C], [], [], []).entries, []);
  assert.deepEqual(pickedScope([C], [S], [], []).entries, [S], 'a schema picked under a listed catalog is still read');
  assert.deepEqual(pickedScope([C], [], [T], []).entries, [T], 'a table picked under a listed catalog is still read');
});

test('removing the last schema or table under a whole catalog stops it being whole, and a catalog that keeps a child stays whole', () => {
  assert.deepEqual(wholeCatalogsAfterChildRemoval([C], [S], []), []);
  assert.deepEqual(wholeCatalogsAfterChildRemoval([C], [S, T], [T]), [C]);
  assert.deepEqual(wholeCatalogsAfterChildRemoval([C], [T], []), []);
  assert.deepEqual(wholeCatalogsAfterChildRemoval(['other', C], [S], []), ['other']);
  assert.deepEqual(wholeCatalogsAfterChildRemoval([C], [], [T]), [C], 'adding a child keeps the catalog whole');
  assert.deepEqual(wholeCatalogsAfterChildRemoval([C], [], []), [C], 'a catalog picked alone is never dropped');
});
