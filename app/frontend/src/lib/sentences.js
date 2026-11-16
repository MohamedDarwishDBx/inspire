// Messages joined into one text (REQ-370). Each part ends with a full stop before the join, so two messages never run on into one
// sentence. The backend keeps the same two lines in backend/lib/sentences.js.
const ENDS_A_SENTENCE = /[.!?]$/;

export function sentenceOf(text) {
  const t = String(text ?? '').trim();
  return t && !ENDS_A_SENTENCE.test(t) ? `${t}.` : t;
}

export function joinSentences(...parts) {
  return parts.map(sentenceOf).filter(Boolean).join(' ');
}
