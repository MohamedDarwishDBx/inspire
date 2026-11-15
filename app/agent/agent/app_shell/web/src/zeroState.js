// The zero-state panel (REQ-147, Amr decision 2A). The server sets zero_state only when the rule finds no exception in the scope,
// so the page shows one plain panel in place of flat charts. The as-of cut-off comes from the stored run summary the page already loads.
export const ZERO_TITLE = 'No matching records found in this data';

import { grouped } from './format.js';

// A table name has dots inside it (main.inspire.orders), so the sentence ends at a full stop followed by a space or the end.
const CUTOFF = /Reads rows dated before[\s\S]*?\.(?=\s|$)/;

export function cutoffNote(summary) {
  return summary?.run?.summary?.match(CUTOFF)?.[0] || '';
}

// REQ-297: what a zero-result run did, in plain words. The one sentence the zero panel, the KPI reason and the Work list all show.
export const foundNothingText = (n) => `This run checked ${grouped(n)} records and found nothing to act on`;

// The zero-result line: shown only when the run wrote a whole-number count of at least one record.
export function checkedNote(zero) {
  const n = zero?.rows_checked;
  return Number.isInteger(n) && n >= 1 ? foundNothingText(n) : '';
}

// The rule in plain words: the decision-list definition the page already holds. Empty when the page holds none, so no line is shown.
export function zeroRule(page) {
  return page?.records?.hint || '';
}
