// Pure helpers for the Ask and Agent answer table: the Genie columns and their values, read by column name so a header always sits over its own values.
import { answerLabel, cellText, isKeyColumn } from './format.js';

export function answerColumns(answer) {
  const rows = answer?.rows || [];
  return (answer?.columns || []).map((c) => {
    const num = !isKeyColumn(c.name, c.type) && rows.some((r) => typeof r[c.name] === 'number') && rows.every((r) => r[c.name] == null || typeof r[c.name] === 'number');
    return { key: c.name, label: answerLabel(c.name), num, render: (r) => (r[c.name] == null ? '' : cellText(r[c.name], c)) };
  });
}

// The steps a finished answer keeps in its Details disclosure, never in the answer text.
export const STEPS_SUMMARY = 'What Genie did';

// What the panel shows while an answer runs: the Genie question is asked in words, never as the relay text the step log keeps.
export function progressLabel(step) {
  const text = String(step || '').trim();
  if (text.startsWith(ASKED_GENIE)) return ASKING_GENIE;
  return text || 'Reading your question';
}
export const ASKED_GENIE = 'Asked Genie:';
export const ASKING_GENIE = 'Asking Genie';
