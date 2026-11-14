import { failureCauseOf } from './plainText.js';

// The refusal a Data Filters read gives for a metric view (backend/lib/metricViews.js). It is a fact about the pick, not a fault.
export const METRIC_VIEW_REFUSAL = /is a metric view, so Inspire leaves it out of Data Filters/;

// The message the columns route gives for a picked table that reads no columns (backend unreadableTableError): it was dropped,
// renamed, or the person cannot read it. Like a missing object, Try again cannot change it.
export const UNREADABLE_PICK = /has no columns Inspire can read\. It was dropped or renamed, or your access does not include it\./;

// A pick that stays wrong until the person changes it, so Try again cannot change it: 'metric_view' (a neutral note) or
// 'missing' (a table, schema or catalog that is gone, or unreadable: an error that names the table). Anything else is '' and may be retried.
export function permanentPickProblem(text) {
  const raw = String(text ?? '');
  if (METRIC_VIEW_REFUSAL.test(raw)) return 'metric_view';
  if (UNREADABLE_PICK.test(raw)) return 'missing';
  return failureCauseOf(raw)?.kind === 'not_found' ? 'missing' : '';
}
