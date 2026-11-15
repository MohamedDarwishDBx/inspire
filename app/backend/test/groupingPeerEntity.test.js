// REQ-293 (rc7 N01-U01, money rebuild 43755420113876): the wizard profile recommended franchiseID, the column named after the use case's
// subject (franchise), as the Grouping of a peer comparison. That column is the entity itself, so each franchise was its own group with no
// peers. A peer comparison never recommends its entity key; another family keeps the subject-named column (must-exclude).
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../lib/groupingRule');
const GP = require('../lib/groupingProfile');

const franchises = (technique) => ({
  table: 'main.sales.franchise_sales', technique, subject: 'Coach franchises by franchiseID against their peers', candidates: ['franchiseID', 'region'], paths: null, time: null, days: 30,
  columns: [{ column_name: 'franchiseID', data_type: 'STRING' }, { column_name: 'region', data_type: 'STRING' }],
  keys: { primary: [], joins: [] }, joins: [], readAt: 'now', sample: [],
  values: [...Array.from({ length: 48 }, (_, i) => ({ col: '0', value: `30000${String(i).padStart(2, '0')}`, records: '67' })),
    ...['east', 'west', 'north', 'south'].map((v) => ({ col: '1', value: v, records: '804' }))],
  stats: { records: '3216', d0: '48', n0: '0', d1: '4', n1: '0' },
});

test('a peer comparison is recognised by its technique or its kind', () => {
  assert.equal(R.peerComparison('Peer Benchmarking'), true);
  assert.equal(R.peerComparison('', 'peer_benchmarking'), true);
  assert.equal(R.peerComparison('Anomaly Detection', 'anomaly'), false, 'must-exclude: other families are not peer comparisons');
});

test('a peer comparison never recommends its entity key, the column named after the subject', () => {
  const d = GP.profileView(franchises('Peer Benchmarking'));
  assert.ok(!d.recommended.includes('franchiseID'), `recommended ${JSON.stringify(d.recommended)}`);
});

test('another family keeps recommending the subject-named column (must-exclude)', () => {
  const d = GP.profileView(franchises('Anomaly Detection'));
  assert.ok(d.recommended.includes('franchiseID'), `recommended ${JSON.stringify(d.recommended)}`);
});

test('the wizard does not list a peer comparison\'s entity key as a grouping choice, and names it instead (REQ-293)', () => {
  const d = GP.profileView(franchises('Peer Benchmarking'));
  assert.ok(!d.columns.some((c) => c.name === 'franchiseID'), `choices ${JSON.stringify(d.columns.map((c) => c.name))}`);
  assert.deepEqual(d.peer_entity, ['franchiseID']);
  assert.ok(d.columns.some((c) => c.name === 'region'), 'the other columns stay choosable');
});

test('another family still lists the subject-named column as a choice (must-exclude)', () => {
  const d = GP.profileView(franchises('Anomaly Detection'));
  assert.ok(d.columns.some((c) => c.name === 'franchiseID'), `choices ${JSON.stringify(d.columns.map((c) => c.name))}`);
  assert.deepEqual(d.peer_entity, []);
});
