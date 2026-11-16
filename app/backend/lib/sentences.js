// Messages joined into one text (REQ-370). Each part ends with a full stop before the join, so two messages never run on into one
// sentence ("...pick its source table instead Its scope was dropped"). The frontend keeps the same two lines in src/lib/sentences.js.
const ENDS_A_SENTENCE = /[.!?]$/;

function sentenceOf(text) {
  const t = String(text ?? '').trim();
  return t && !ENDS_A_SENTENCE.test(t) ? `${t}.` : t;
}

function joinSentences(...parts) {
  return parts.map(sentenceOf).filter(Boolean).join(' ');
}

module.exports = { sentenceOf, joinSentences };
