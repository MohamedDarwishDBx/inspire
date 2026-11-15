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
