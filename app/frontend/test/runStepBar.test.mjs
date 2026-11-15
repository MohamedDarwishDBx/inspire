// REQ-126 (P81): the Review step bar lists the Data Filter Label step when the run's steps say it ran, and never otherwise.
// Fail-pre: before the fix the bar was a fixed list of seven stages, so a labelled run showed no label step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stepBarStagesOf, dataFilterLabelRanIn } from '../src/lib/runStepBar.js';

const STAGES = ['Setup', 'Business Understanding', 'Use Case Design', 'Domain Mapping', 'Prioritization', 'Implementation', 'Executive Readout'];
const LABEL_ROW = { stage_name: 'Final Gate', step_name: 'Inspire is working on data filter label', sub_step_name: 'Completed: complete', status: 'ended_success' };

test('a labelled run shows the Data Filter Label step on the bar, before Implementation', () => {
  const bar = stepBarStagesOf(STAGES, [{ stage_name: 'Prioritization', step_name: 'Quality bar', status: 'ended_success' }, LABEL_ROW]);
  assert.deepEqual(bar, ['Setup', 'Business Understanding', 'Use Case Design', 'Domain Mapping', 'Prioritization', 'Data Filter Label', 'Implementation', 'Executive Readout']);
});

test('an unlabelled run does not show the Data Filter Label step (must-exclude)', () => {
  const steps = [{ stage_name: 'Prioritization', step_name: 'Quality bar', status: 'ended_success' }];
  assert.deepEqual(stepBarStagesOf(STAGES, steps), STAGES);
  assert.equal(dataFilterLabelRanIn(steps), false);
  assert.deepEqual(stepBarStagesOf(STAGES, undefined), STAGES, 'no step rows yet, no label step');
});

test('a label step that started and never finished is not shown as ran', () => {
  const started = { ...LABEL_ROW, status: 'started', sub_step_name: 'In progress: started' };
  assert.equal(dataFilterLabelRanIn([started]), false);
  assert.deepEqual(stepBarStagesOf(STAGES, [started]), STAGES);
});

test('the bar does not mistake the label reask step for the label step', () => {
  const reask = { stage_name: 'Use Case Prioritization', step_name: 'Tidying Data Filter Labels', status: 'ended_success' };
  assert.equal(dataFilterLabelRanIn([reask]), false);
});

test('the warning label step counts as ran (the label did fall back, but the step ran)', () => {
  assert.equal(dataFilterLabelRanIn([{ ...LABEL_ROW, status: 'ended_warning' }]), true);
});
