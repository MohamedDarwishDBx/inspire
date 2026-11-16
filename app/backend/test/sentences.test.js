// REQ-370: messages joined into one text never run on into one sentence. A part without its full stop gets one before the join.
const test = require('node:test');
const assert = require('node:assert/strict');
const { joinSentences, sentenceOf } = require('../lib/sentences');

test('two messages joined without a full stop read as two sentences, not one run-on (REQ-370)', () => {
  const refusal = 'customer_value_metrics is a metric view, so Inspire leaves it out of Data Management; pick its source table instead';
  assert.equal(joinSentences(refusal, 'Its scope was dropped.'), `${refusal}. Its scope was dropped.`);
  assert.doesNotMatch(joinSentences(refusal, 'Its scope was dropped.'), /instead Its/);
});

test('a part that already ends a sentence is not given a second full stop, and empty parts are dropped', () => {
  assert.equal(joinSentences('One.', '', 'Two?', null, 'Three'), 'One. Two? Three.');
  assert.equal(sentenceOf('  '), '');
  assert.equal(joinSentences(), '');
});
