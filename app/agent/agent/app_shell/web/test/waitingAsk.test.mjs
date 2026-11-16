import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitingAskOf, INSPIRE_OWNER, WAITING_INSPIRE_ACTION } from '../src/plainText.js';

const UUID = 'b2b3b070-1da5-45c3-b5b6-81a2feaf85bb';

test('a view Inspire owns says the plain action, never a principal id or a person to ask (REQ-185)', () => {
  assert.equal(waitingAskOf([INSPIRE_OWNER]), WAITING_INSPIRE_ACTION);
  assert.equal(waitingAskOf(['Inspire']), 'Its owner can press Check again after a rebuild, or Inspire grants it on the next build.');
});

test('a principal id is never named as whom to ask; with nobody known the page says your data owner (REQ-185)', () => {
  assert.equal(waitingAskOf([UUID]), 'Ask your data owner to grant it.');
  assert.equal(waitingAskOf([UUID, INSPIRE_OWNER]), WAITING_INSPIRE_ACTION);
  assert.doesNotMatch(waitingAskOf([UUID, INSPIRE_OWNER]), new RegExp(UUID));
  assert.equal(waitingAskOf(undefined), 'Ask your data owner to grant it.');
});

test('a named owner keeps the ask sentence, joined with or (REQ-040)', () => {
  assert.equal(waitingAskOf(['Dana Ortiz']), 'Ask Dana Ortiz to grant it.');
  assert.equal(waitingAskOf(['Dana Ortiz', 'Sam Lee']), 'Ask Dana Ortiz or Sam Lee to grant it.');
});
