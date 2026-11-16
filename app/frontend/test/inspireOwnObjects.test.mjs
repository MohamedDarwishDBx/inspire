// REQ-387: the App reads naming uses the one rule (inspireOwnObjects.js); a person's table named like a working view keeps its name.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appReadsName } from '../src/lib/implementWizard.js';
import { isInspireOwnName } from '../src/lib/inspireOwnObjects.js';

test('an Inspire working view reads as the working copy, a person table keeps its name (REQ-387)', () => {
  assert.equal(appReadsName('main.s.orders__implement_scope'), "this use case's working copy of its data");
  assert.equal(appReadsName('main.s.__inspire_usecases'), "this use case's working copy of its data");
  assert.equal(appReadsName('main.s.customer_scope'), 'main.s.customer_scope');
  assert.equal(appReadsName('main.s.scope'), 'main.s.scope');
  assert.equal(isInspireOwnName('main.s.scope'), false);
});
