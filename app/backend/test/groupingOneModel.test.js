// REQ-193: a kind whose family registers one model (kinds.json model_families) fits one model across all the data, so the wizard profile
// recommends no Grouping for it and says why in plain words. A kind that fits a model per group keeps its recommendation (must-exclude).
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../lib/groupingRule');
const GP = require('../lib/groupingProfile');

const base = (technique) => ({
  table: 'main.sales.orders', technique, candidates: ['region', 'payment'], paths: null, time: null, days: 30,
  columns: [{ column_name: 'region', data_type: 'STRING' }, { column_name: 'payment', data_type: 'STRING' }],
  keys: { primary: [], joins: [] }, joins: [], readAt: 'now',
  sample: [{ kind: 'size', coarse: '0', fine: '-1', groups: '4', records: '4600' }, { kind: 'size', coarse: '1', fine: '-1', groups: '3', records: '4600' }],
  values: [...['east', 'west', 'north', 'south'].map((v, i) => ({ col: '0', value: v, records: String(1000 + i * 100) })),
    ...['visa', 'amex', 'mastercard'].map((v, i) => ({ col: '1', value: v, records: String(1400 + i * 50) }))],
  stats: { records: '4600', d0: '4', n0: '0', d1: '3', n1: '0' },
});

test('the kinds that register one model are read from kinds.json, and only a technique that works in groups fits one (must-exclude: the rest)', () => {
  for (const technique of ['Segmentation', 'Clustering', 'Anomaly Detection', 'Predictive Modeling']) assert.equal(R.fitsOneModel(technique), true, technique);
  for (const technique of ['Forecasting', 'Peer Benchmarking', 'Trend Analysis', 'Optimization', 'Sentiment Analysis', 'Recommendation', '']) {
    assert.equal(R.fitsOneModel(technique), false, technique);
  }
});

test('a one-model kind is profiled with no recommended Grouping and a plain reason that the whole data is one group', () => {
  const d = GP.profileView(base('Segmentation'));
  assert.deepEqual([d.applies, d.qualifies, d.recommended, d.recommended_by], [true, false, [], '']);
  assert.equal(d.reason, 'Inspire fits one model across all of main.sales.orders for Segmentation, so the whole data is one group. Splitting it into groups '
    + 'would need one registered model per group, and Inspire registers one model per use case, so choosing columns is refused when the use case is built.');
});

test('a one-model kind named with a column in its use case still gets no recommendation (must-exclude: the name does not split it)', () => {
  const d = GP.profileView({ ...base('Anomaly Detection'), subject: 'Flag odd payments by region', deep: ['payment'] });
  assert.deepEqual([d.recommended, d.qualifies], [[], false]);
});

test('a kind that fits a model per group keeps its statistics recommendation and its reason (must-exclude)', () => {
  const d = GP.profileView(base('Peer Benchmarking'));
  assert.deepEqual([d.qualifies, d.recommended_by], [true, 'statistics']);
  assert.match(d.reason, /^Inspire recommends /);
});
