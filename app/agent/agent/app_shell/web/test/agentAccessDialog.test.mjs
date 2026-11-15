// REQ-313: an access denial the agent raises opens the App shell's Permission Required dialog (WaitingForAccess), never a second
// dialog. The mapping hands it the tables the App cannot read and their owners; the agent's access card renders it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { accessWaiting } from '../src/agentView.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = (name) => fs.readFileSync(path.join(HERE, '..', 'src', name), 'utf8');

test('an agent access denial hands the shell dialog the tables the App cannot read and who owns them', () => {
  const access = { tables: [{ table: 'main.s.returns', owner: 'data@example.com', grants: ['USE SCHEMA'] }, { table: 'main.s.b', owner: null, grants: [] }] };
  assert.deepEqual(accessWaiting(access), { tables: ['main.s.returns', 'main.s.b'], owners: ['data@example.com', null], detail: '' });
  assert.deepEqual(accessWaiting(null), { tables: [], owners: [], detail: '' }, 'no access, no tables');
});

test('the agent renders an access denial with the shell WaitingForAccess dialog and no second dialog', () => {
  const parts = src('AgentParts.jsx');
  assert.match(parts, /import WaitingForAccess from '\.\/WaitingForAccess\.jsx'/);
  assert.match(parts, /kind === 'access'\s*\?\s*<div className="ag-confirm" data-confirm="access"><WaitingForAccess waiting=\{accessWaiting\(message\.confirm\.access\)\}/);
  assert.doesNotMatch(parts, /AccessActions/, 'the access card is the shell dialog, not a second copy of its buttons');
});
