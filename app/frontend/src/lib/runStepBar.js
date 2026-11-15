// REQ-126 (P81): the Review step bar is built from the steps the run recorded (the same rows the Monitor reads), so the
// Data Filter Label step shows when it ran and stays off the bar when it did not.
const LABEL_STEP_NAMES = new Set(['data filter label', 'inspire is working on data filter label']);
const RAN_STATUSES = new Set(['ended_success', 'ended_warning']);
const BEFORE_LABEL = 'Implementation';

export function dataFilterLabelRanIn(steps) {
  return (Array.isArray(steps) ? steps : []).some((s) => s && LABEL_STEP_NAMES.has(String(s.step_name || '').trim().toLowerCase())
    && RAN_STATUSES.has(s.status));
}

// The bar's stages, with the label step inserted before Implementation when the run recorded it as finished.
export function stepBarStagesOf(stages, steps) {
  if (!dataFilterLabelRanIn(steps)) return [...stages];
  const at = stages.indexOf(BEFORE_LABEL);
  const out = [...stages];
  out.splice(at < 0 ? out.length : at, 0, 'Data Filter Label');
  return out;
}
