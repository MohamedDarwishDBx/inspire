const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

// REQ-323: the history route reads the latest run of every use case with one warehouse statement, not one per use case.
const N = 20;
const HISTORY = Array.from({ length: N }, (_, i) => ({
  use_case_id: `N01-U${String(i + 1).padStart(2, '0')}`,
  spec_version: 1,
  status: 'ready',
  spec_json: { use_case_id: `N01-U${String(i + 1).padStart(2, '0')}`, config: { result_table: `main.inspire.uc${i}_out` } },
}));
const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42';

test('the history route reads the latest run of 20 use cases in one statement (REQ-323)', async () => {
  const { app, sqlCalls } = makeApp({ history: HISTORY, statements: { 'run_rank = 1': { rows: [] } } });
  const srv = await listen(app);
  try {
    const resp = await fetch(`${srv.url}/api/inspire/implement/history?${Q}`);
    assert.equal(resp.status, 200);
    const summaryReads = sqlCalls.filter((c) => String(c.sql).includes('_summary'));
    assert.equal(summaryReads.length, 1, `one statement for ${N} use cases, got ${summaryReads.length}`);
    assert.equal(summaryReads[0].parameters.length, N, 'every use case is bound in that one statement');
  } finally {
    await srv.close();
  }
});

test('a run row is mapped back to its own use case (REQ-323)', async () => {
  const runs = [{ use_case_id: 'N01-U02', not_reliable: 'Two rows are missing', updated_at: '2026-11-15' }];
  const { app } = makeApp({ history: HISTORY.slice(0, 2), statements: { 'run_rank = 1': { rows: runs } } });
  const srv = await listen(app);
  try {
    const got = await (await fetch(`${srv.url}/api/inspire/implement/history?${Q}`)).json();
    const byId = Object.fromEntries(got.latest.map((row) => [row.use_case_id, row.latest_run]));
    assert.deepEqual(byId['N01-U02'], { not_reliable: 'Two rows are missing', updated_at: '2026-11-15' });
    assert.deepEqual(byId['N01-U01'], { not_reliable: '', updated_at: '' });
  } finally {
    await srv.close();
  }
});

// REQ-323: one missing summary table must not empty the run read of every other use case.
test('one missing summary table still shows the other use cases runs (must-keep, REQ-323)', async () => {
  const three = HISTORY.slice(0, 3);
  const runs = [
    { use_case_id: 'N01-U01', not_reliable: 'First run stopped', updated_at: '2026-11-14' },
    { use_case_id: 'N01-U03', not_reliable: '', updated_at: '2026-11-15' },
  ];
  const missingMessage = '[TABLE_OR_VIEW_NOT_FOUND] The table or view `main`.`inspire`.`uc1_out_summary` cannot be found. SQLSTATE: 42P01';
  const { app, sqlCalls } = makeApp({
    history: three,
    sqlErrors: { 'uc1_out_summary': missingMessage },
    statements: { 'run_rank = 1': { rows: runs } },
  });
  const srv = await listen(app);
  try {
    const resp = await fetch(`${srv.url}/api/inspire/implement/history?${Q}`);
    assert.equal(resp.status, 200);
    const got = await resp.json();
    const byId = Object.fromEntries(got.latest.map((row) => [row.use_case_id, row.latest_run]));
    assert.deepEqual(byId['N01-U01'], { not_reliable: 'First run stopped', updated_at: '2026-11-14' }, 'the use case whose table exists keeps its run');
    assert.deepEqual(byId['N01-U03'], { not_reliable: '', updated_at: '2026-11-15' }, 'the third use case keeps its run too');
    assert.deepEqual(byId['N01-U02'], { not_reliable: '', updated_at: '' }, 'the use case with the missing table reads as no run, not as an error');
    assert.ok(sqlCalls.filter((c) => String(c.sql).includes('_summary')).length >= 2, 'the batch failed, then each table was read on its own');
  } finally {
    await srv.close();
  }
});

test('with every summary table present the route still issues one statement (REQ-323)', async () => {
  const { app, sqlCalls } = makeApp({ history: HISTORY.slice(0, 5), statements: { 'run_rank = 1': { rows: [] } } });
  const srv = await listen(app);
  try {
    await fetch(`${srv.url}/api/inspire/implement/history?${Q}`);
    assert.equal(sqlCalls.filter((c) => String(c.sql).includes('_summary')).length, 1);
  } finally {
    await srv.close();
  }
});
