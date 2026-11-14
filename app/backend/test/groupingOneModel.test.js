// REQ-193: family C (segmentation, clustering) fits one registered model per use case, so its per-group fit is refused. The wizard profile
// recommends no column for it, the Run page offers only the whole data, and the reason says why. Anomaly (B) and the rest keep their
// planned Grouping (must-exclude).
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../lib/groupingRule');
const GP = require('../lib/groupingProfile');
const { groupingChoices } = require('../../frontend/src/lib/runScope.js');

const base = (technique) => ({
  table: 'main.sales.orders', technique, candidates: ['region', 'payment'], paths: null, time: null, days: 30,
  columns: [{ column_name: 'region', data_type: 'STRING' }, { column_name: 'payment', data_type: 'STRING' }],
  keys: { primary: [], joins: [] }, joins: [], readAt: 'now',
  sample: [{ kind: 'size', coarse: '0', fine: '-1', groups: '4', records: '4600' }, { kind: 'size', coarse: '1', fine: '-1', groups: '3', records: '4600' }],
  values: [...['east', 'west', 'north', 'south'].map((v, i) => ({ col: '0', value: v, records: String(1000 + i * 100) })),
    ...['visa', 'amex', 'mastercard'].map((v, i) => ({ col: '1', value: v, records: String(1400 + i * 50) }))],
  stats: { records: '4600', d0: '4', n0: '0', d1: '3', n1: '0' },
});

test('only family C techniques fit one model, read from kinds.json (must-exclude: every per-group family)', () => {
  for (const technique of ['Segmentation', 'Clustering']) assert.equal(R.fitsOneModel(technique), true, technique);
  for (const technique of ['Anomaly Detection', 'Predictive Modeling', 'Forecasting', 'Peer Benchmarking', 'Trend Analysis', 'Optimization', '']) {
    assert.equal(R.fitsOneModel(technique), false, technique);
  }
});

test('a segmentation profile recommends no column, lists only the whole data, and says why in plain words', () => {
  const d = GP.profileView(base('Segmentation'));
  assert.deepEqual([d.one_model, d.applies, d.qualifies, d.recommended, d.recommended_by, d.columns], [true, true, false, [], '', []]);
  assert.equal(d.reason, 'Inspire fits one model across all of main.sales.orders for Segmentation, so the whole data is one group. Splitting it into groups '
    + 'would need one registered model per group, and Inspire registers one model per use case, so choosing columns is refused when the use case is built.');
  const choices = groupingChoices(d, ['region', 'all']).map((c) => c.value);
  assert.deepEqual(choices, ['all'], 'the Run page offers no column for a one-model kind, whatever the widget lists');
});

test('an anomaly use case keeps its planned Grouping: the statistics recommendation and its per-group reason (must-exclude)', () => {
  const d = GP.profileView(base('Anomaly Detection'));
  assert.deepEqual([d.one_model, d.qualifies, d.recommended, d.recommended_by], [false, true, ['payment'], 'statistics']);
  assert.match(d.reason, /^Inspire recommends payment because Anomaly Detection works out what is normal inside each group/);
  assert.ok(groupingChoices(d, ['all']).some((c) => c.value === 'payment'), 'the planned column stays on the Run page');
});

test('a person-named or Discovery column still applies to an anomaly use case (must-exclude)', () => {
  const d = GP.profileView({ ...base('Anomaly Detection'), subject: 'Flag odd payments by region', deep: ['payment'] });
  assert.deepEqual([d.recommended, d.recommended_by], [['payment'], 'discovery']);
});
