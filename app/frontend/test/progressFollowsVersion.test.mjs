import test from 'node:test';
import assert from 'node:assert/strict';
import { mvpStages, statusProgress } from '../src/lib/mvpProgress.js';

// REQ-356: the build progress follows the version the card shows. A failed v1 step must not colour the v2 panel.
const NOW = Date.parse('2026-11-16T10:30:00Z');
const stepRow = (phase, status, at, specVersion) => ({
  stage_name: 'Implement Use Cases', step_name: `Inspire is working on ${phase.toLowerCase()}`, sub_step_name: 'Completed: n01-u01',
  status, last_updated: at, result_json: { use_case_id: 'N01-U01', phase, spec_version: specVersion },
});
const V1_FAILED = [stepRow('Genie build', 'started', '2026-11-16T10:00:00Z', 1), stepRow('Genie build', 'ended_error', '2026-11-16T10:20:00Z', 1)];
const latestV2 = { spec_version: 2, status: 'building_outputs' };

test('a failed v1 step does not mark the v2 progress panel as failed (REQ-356)', () => {
  const stages = mvpStages(V1_FAILED, latestV2, { now: NOW });
  assert.deepEqual(stages.filter((s) => s.state === 'error').map((s) => s.id), [], 'no stage of v2 reads error from v1');
  assert.equal(stages.find((s) => s.id === 'Genie build').state, 'waiting', 'v2 has no step of its own yet');
});

test('the rail progress of a v2 build ignores the failed v1 steps too (REQ-356, the list and the detail read the same rule)', () => {
  const rail = statusProgress({ steps: V1_FAILED, latest: latestV2 }, NOW);
  assert.doesNotMatch(String(rail.step), /fail|error/i);
});

test('the same failed step still marks its own version (REQ-356 must-exclude: the filter is by version, not a blanket skip)', () => {
  const stages = mvpStages(V1_FAILED, { spec_version: 1, status: 'failed' }, { now: NOW });
  assert.deepEqual(stages.filter((s) => s.state === 'error').map((s) => s.id), ['Genie build']);
});

test('a v2 step is shown on the v2 panel while the older v1 step is ignored (REQ-356)', () => {
  const steps = [...V1_FAILED, stepRow('Genie build', 'started', '2026-11-16T10:25:00Z', 2)];
  const stages = mvpStages(steps, latestV2, { now: NOW });
  assert.equal(stages.find((s) => s.id === 'Genie build').state, 'running');
});
