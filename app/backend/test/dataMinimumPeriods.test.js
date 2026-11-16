// REQ-255: a forecast's data minimum counts periods (distinct dates of its event column), the count the build's check makes.
// Fail before: the readiness probe counted raw rows only, so 3,333 rows of 17 days passed a 60-period minimum.
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/inspireImplement');

test('a forecast technique maps to family E and its minimum is 60 periods', () => {
  assert.equal(I.analysisFamilyOf('Forecasting'), 'E');
  assert.equal(I.analysisMinimumRows('Forecasting'), 60);
  assert.equal(I.analysisFamilyOf('Classification'), 'A');
  assert.equal(I.analysisFamilyOf('no such technique'), '');
});

test('the readiness statement counts distinct dates of the period column only when one is given', () => {
  const withPeriods = I.readinessStatement('main.s.sales', { columns: ['qty'], window: { column: 'sold_at' }, periodColumn: 'sold_at' });
  assert.match(withPeriods.sql, /COUNT\(DISTINCT CAST\(`sold_at` AS DATE\)\) AS period_count/);
  const rowsOnly = I.readinessStatement('main.s.sales', { columns: ['qty'], window: { column: 'sold_at' } });
  assert.doesNotMatch(rowsOnly.sql, /period_count/, 'a kind that counts rows keeps the row-only statement');
});

test('the readiness row carries period_count when the statement counted it', () => {
  assert.equal(I.readinessFromRow({ row_count: 3333, period_count: 17 }, []).period_count, 17);
  assert.equal(I.readinessFromRow({ row_count: 3333 }, []).period_count, undefined);
});
