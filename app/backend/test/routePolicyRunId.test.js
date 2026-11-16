const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const P = require('../lib/routePolicy');

const realFetch = globalThis.fetch;
const RUN = '424242424242';

// A tiny App with the real policy gate on the run routes. Each deps override answers one read the gate makes.
async function startApp(overrides = {}) {
  const app = express();
  app.use(express.json());
  const deps = {
    enforce: () => true,
    appName: () => 'inspire',
    appDatabase: () => 'main.inspire',
    personOf: () => 'me@example.com',
    personToken: () => 'token',
    readAcl: async () => ({ ok: true, data: {} }),
    readMe: async () => ({ ok: true, data: {} }),
    readLauncher: async () => 'me@example.com',
    readHistory: async () => [],
    runRecorded: async () => true,
    ...overrides,
  };
  const guard = P.enforceRoutePolicy(app, P.createRoutePolicy(deps));
  let ran = 0;
  app.get('/api/run/:runId', (_req, res) => { ran += 1; res.json({ ok: true }); });
  app.post('/api/run/:runId/again', (_req, res) => { ran += 1; res.json({ ok: true }); });
  const server = await new Promise((resolve) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (p) => { const r = await realFetch(`${base}${p}`); return { status: r.status, data: await r.json() }; };
  const post = async (p) => { const r = await realFetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); return { status: r.status, data: await r.json() }; };
  return { guard, get, post, ran: () => ran, stop: () => new Promise((resolve) => server.close(resolve)) };
}

test('(3) an empty run id answers 400 with a plain message and never builds a "run " label (fail-pre: it answered 403 "has no record of run ,")', async () => {
  const seen = [];
  const t = await startApp({ runRecorded: async (_req, id) => { seen.push(id); return false; } });
  try {
    for (const path of ['/api/run/%20', '/api/run/%20/again']) {
      const got = path.endsWith('/again') ? await t.post(path) : await t.get(path);
      assert.equal(got.status, 400, `${path} answered ${got.status}: ${JSON.stringify(got.data)}`);
      assert.equal(typeof got.data.error, 'string');
      assert.doesNotMatch(got.data.error, /run\s*[,.]|run ,|label/, 'no empty id in the sentence');
      assert.equal(got.data.policy, undefined, 'a malformed request is a plain 400, not a policy refusal');
    }
    assert.deepEqual(seen, [], 'no record read happens for an empty id');
    assert.equal(t.ran(), 0, 'the handler never runs');
  } finally {
    await t.stop();
  }
});

test('(2) a truly unrecorded run still refuses 403 with the run id in the sentence (must-exclude: the refusal is not removed)', async () => {
  const t = await startApp({ runRecorded: async () => false });
  try {
    const got = await t.get(`/api/run/${RUN}`);
    assert.equal(got.status, 403);
    assert.equal(got.data.policy.rule, 'recorded');
    assert.match(got.data.error, new RegExp(`^Inspire shows only runs it launched and recorded in its own database, and it has no record of run ${RUN}, so it does not read it\\.$`));
    assert.equal(t.ran(), 0);
  } finally {
    await t.stop();
  }
});

test('a record read that fails answers 503 "try again", never the permanent "no record" refusal (fail-pre: it answered 403)', async () => {
  const t = await startApp({ runRecorded: async () => { throw new Error('warehouse is starting'); } });
  try {
    const got = await t.get(`/api/run/${RUN}`);
    assert.equal(got.status, 503, JSON.stringify(got.data));
    assert.match(got.data.error, /could not check its record of run 424242424242 just now/);
    assert.doesNotMatch(got.data.error, /no record/);
    assert.equal(t.ran(), 0);
  } finally {
    await t.stop();
  }
});

test('a recorded run passes the gate and the handler runs (must-pass control)', async () => {
  const t = await startApp({ runRecorded: async () => true });
  try {
    const got = await t.get(`/api/run/${RUN}`);
    assert.equal(got.status, 200);
    assert.equal(t.ran(), 1);
  } finally {
    await t.stop();
  }
});

test('a launch-record read that fails on cancel or run again answers 503 "try again", not "no record of who launched it"', async () => {
  const t = await startApp({ readLauncher: async () => { throw new Error('timeout'); } });
  try {
    const got = await t.post(`/api/run/${RUN}/again`);
    assert.equal(got.status, 503, JSON.stringify(got.data));
    assert.match(got.data.error, /could not read the launch record of run 424242424242 just now/);
    assert.doesNotMatch(got.data.error, /no record of who launched/);
  } finally {
    await t.stop();
  }
});
