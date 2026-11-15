// REQ-260, D-NAMES: Inspire's own working views are never shown by their generated name; a source table keeps its name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appReadsName } from '../src/lib/implementWizard.js';

const WALK_VIEW = 'inspire_kinds_rc7._inspire.inspire_kinds_rc7__inspire_walk_v153_e2e_n01_u02_n01_u02_results__signal__n01_u02__implement_scope';

test('the exact walk string names the working copy, never the generated view (must-exclude)', () => {
  const name = appReadsName(WALK_VIEW);
  assert.equal(name, "this use case's working copy of its data");
  assert.doesNotMatch(name, /__|_inspire|implement_scope|USE SCHEMA|SELECT|READ METADATA/);
});

test('a source table keeps its fully qualified name (must-keep, D-NAMES)', () => {
  assert.equal(appReadsName('main.sales.orders'), 'main.sales.orders');
  assert.equal(appReadsName('adb_fe_uae_01.demo_telco.customers'), 'adb_fe_uae_01.demo_telco.customers');
});
