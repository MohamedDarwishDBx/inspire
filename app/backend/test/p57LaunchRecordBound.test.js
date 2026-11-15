// REQ-231: a launch-record write that never leaves PENDING is stopped by its signal, so the launch cannot hang on it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createExecuteSql } = require('../lib/sqlStatements');

test('an insert that stays PENDING is cancelled once its signal aborts, and the call throws SQL_CANCELLED', async () => {
  const calls = [];
  const controller = new AbortController();
  const dbFetch = async (host, token, path, init = {}) => {
    calls.push({ path, method: init.method || 'GET' });
    if (path === '/api/2.0/sql/statements' && init.method === 'POST') {
      return { ok: true, status: 200, json: async () => ({ statement_id: 's1', status: { state: 'PENDING' } }), text: async () => '' };
    }
    if (path.endsWith('/cancel')) return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    controller.abort();
    return { ok: true, status: 200, json: async () => ({ statement_id: 's1', status: { state: 'PENDING' } }), text: async () => '' };
  };
  const executeSql = createExecuteSql(dbFetch, { sleep: async () => {} });
  await assert.rejects(executeSql('h', 't', 'wh', 'INSERT INTO x VALUES (1)', null, { signal: controller.signal }), (e) => e.code === 'SQL_CANCELLED');
  assert.ok(calls.some((c) => c.path === '/api/2.0/sql/statements/s1/cancel'), 'the pending statement is cancelled in the warehouse too');
});
