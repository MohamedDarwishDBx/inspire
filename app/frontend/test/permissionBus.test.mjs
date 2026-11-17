// REQ-220: one dialog per distinct grant list. The same list raised twice opens once; a different list opens; one host receives each raise.
import test from 'node:test';
import assert from 'node:assert/strict';
import { raisePermissions, subscribePermissions } from '../src/lib/permissionBus.js';

const listA = (n) => [{ statements: [`GRANT SELECT ON TABLE \`main\`.\`s\`.\`a${n}\` TO \`app-sp\`;`], principal: 'app-sp' }];
const listB = (n) => [{ statements: [`GRANT SELECT ON TABLE \`main\`.\`s\`.\`b${n}\` TO \`app-sp\`;`], principal: 'app-sp' }];

test('the same grant list raised twice opens the dialog once: the second raise is quiet', () => {
  const calls = [];
  const off = subscribePermissions((permissions, extra, opts = {}) => calls.push({ quiet: Boolean(opts.quiet) }));
  raisePermissions(listA(1));
  raisePermissions(listA(1));
  off();
  assert.deepEqual(calls.map((c) => c.quiet), [false, true], 'one open, then a quiet repeat');
});

test('a different grant list still opens the dialog', () => {
  const calls = [];
  const off = subscribePermissions((permissions, extra, opts = {}) => calls.push({ quiet: Boolean(opts.quiet) }));
  raisePermissions(listA(2));
  raisePermissions(listB(2));
  off();
  assert.deepEqual(calls.map((c) => c.quiet), [false, false], 'the new list opens');
});

test('with two hosts mounted, a raise reaches one host only, so two dialogs never stack', () => {
  const first = [];
  const second = [];
  const offFirst = subscribePermissions(() => first.push(1));
  const offSecond = subscribePermissions(() => second.push(1));
  raisePermissions(listA(3));
  offSecond();
  offFirst();
  assert.equal(first.length + second.length, 1, 'exactly one host receives the raise');
  assert.equal(second.length, 1, 'the host mounted last takes over');
});

// REQ-239, REQ-138: the once-per-list memory survives a page load in the same tab, so a grant list the person already saw stays closed.
function fakeSessionStorage(initial = {}) {
  const data = { ...initial };
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, data };
}

test('a grant list shown before a page load stays closed after the load (sessionStorage memory)', () => {
  const stored = `GRANT CREATE ON DATABASE \`databricks_postgres\` TO \`reload-probe\`;`;
  const storage = fakeSessionStorage({ 'inspire.permissionStatementsShown': JSON.stringify([stored]) });
  globalThis.sessionStorage = storage;
  try {
    const calls = [];
    const off = subscribePermissions((permissions, extra, opts = {}) => calls.push({ quiet: Boolean(opts.quiet) }));
    raisePermissions([{ statements: [stored], optional: true, principal: 'reload-probe' }]);
    off();
    assert.deepEqual(calls, [{ quiet: true }], 'a list already in the session memory never reopens: only a quiet notice reaches the host');
  } finally {
    delete globalThis.sessionStorage;
  }
});

test('a new grant list is saved to sessionStorage so the next page load keeps it closed', () => {
  const storage = fakeSessionStorage();
  globalThis.sessionStorage = storage;
  try {
    const fresh = 'GRANT SELECT ON TABLE `main`.`s`.`persisted_probe` TO `app-sp`;';
    const calls = [];
    const off = subscribePermissions((permissions, extra, opts = {}) => calls.push({ quiet: Boolean(opts.quiet) }));
    raisePermissions([{ statements: [fresh], principal: 'app-sp' }]);
    off();
    assert.equal(calls.length, 1, 'the first sight of a new list opens the dialog');
    assert.deepEqual(JSON.parse(storage.data['inspire.permissionStatementsShown']), [fresh], 'the list is saved for the session');
  } finally {
    delete globalThis.sessionStorage;
  }
});

// REQ-239 (rest): an optional entry with no GRANT statement is remembered too, so a reload does not reopen it.
test('an optional grant entry with no statement shown before a page load stays closed after the load', () => {
  const entry = { statements: [], principal: 'reload-probe-owner', securable: 'main.s.orders', privilege: 'SELECT', optional: true, why: 'pages load faster' };
  const storage = fakeSessionStorage({ 'inspire.permissionStatementsShown': JSON.stringify([`entry:${JSON.stringify(['reload-probe-owner', 'main.s.orders', 'SELECT', 'pages load faster'])}`]) });
  globalThis.sessionStorage = storage;
  try {
    const calls = [];
    const off = subscribePermissions((permissions, extra, opts = {}) => calls.push({ quiet: Boolean(opts.quiet) }));
    raisePermissions([entry]);
    off();
    assert.deepEqual(calls, [{ quiet: true }], 'a statement-less entry already shown never reopens');
  } finally {
    delete globalThis.sessionStorage;
  }
});

test('a new statement-less optional entry is saved by identity, and a different one still opens', () => {
  const storage = fakeSessionStorage();
  globalThis.sessionStorage = storage;
  try {
    const first = { statements: [], principal: 'owner-a', securable: 'main.s.a', privilege: 'SELECT', optional: true, why: 'a' };
    const other = { statements: [], principal: 'owner-b', securable: 'main.s.b', privilege: 'SELECT', optional: true, why: 'b' };
    const calls = [];
    const off = subscribePermissions((permissions, extra, opts = {}) => calls.push({ quiet: Boolean(opts.quiet) }));
    raisePermissions([first]);
    raisePermissions([first]);
    raisePermissions([other]);
    off();
    assert.deepEqual(calls, [{ quiet: false }, { quiet: true }, { quiet: false }], 'open, quiet repeat, then the other entry opens');
    assert.equal(JSON.parse(storage.data['inspire.permissionStatementsShown']).length, 2, 'both identities are saved');
  } finally {
    delete globalThis.sessionStorage;
  }
});

// REQ-408 + REQ-138: the coarse statements of a dialog are one list, so a page that raises the same coarse grants again stays closed.
test('a coarse schema-level grant list raised twice opens once, and a whole-catalog list is a different list', () => {
  const coarse = [{ statements: ['GRANT USE CATALOG ON CATALOG `main` TO `app-sp`', 'GRANT SELECT ON SCHEMA `main`.`s` TO `app-sp`'], principal: 'app-sp' }];
  const catalog = [{ statements: ['GRANT USE CATALOG ON CATALOG `main` TO `app-sp`', 'GRANT SELECT ON CATALOG `main` TO `app-sp`'], principal: 'app-sp' }];
  const calls = [];
  const off = subscribePermissions((permissions, extra, opts = {}) => calls.push({ quiet: Boolean(opts.quiet) }));
  raisePermissions(coarse);
  raisePermissions(coarse);
  raisePermissions(catalog);
  off();
  assert.deepEqual(calls.map((c) => c.quiet), [false, true, false], 'open, quiet repeat, then the catalog list opens');
});
