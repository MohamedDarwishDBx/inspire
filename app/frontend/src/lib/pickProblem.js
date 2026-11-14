import { failureCauseOf } from './plainText.js';

// The refusal a Data Filters read gives for a metric view (backend/lib/metricViews.js). It is a fact about the pick, not a fault.
export const METRIC_VIEW_REFUSAL = /is a metric view, so Inspire leaves it out of Data Filters/;

// A pick that stays wrong until the person changes it, so Try again cannot change it: 'metric_view' (a neutral note) or
// 'missing' (a table, schema or catalog that is gone: an error that names the table). Anything else is '' and may be retried.
export function permanentPickProblem(text) {
  const raw = String(text ?? '');
  if (METRIC_VIEW_REFUSAL.test(raw)) return 'metric_view';
  return failureCauseOf(raw)?.kind === 'not_found' ? 'missing' : '';
}
