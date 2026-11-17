// REQ-404 part 2: a page the App set aside shows its notice in place of its data, and every other page shows its data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asideNotice } from '../src/setAside.js';

const here = dirname(fileURLToPath(import.meta.url));
const src = (file) => readFileSync(join(here, '..', 'src', file), 'utf8');
const NOTICE = 'page Sales desk needs its use case built again. The App keeps this page set aside until then.';

test('a set-aside page gives its notice, and a page the App serves gives none', () => {
  assert.equal(asideNotice({ id: 'n01_u05', set_aside: NOTICE }), NOTICE);
  assert.equal(asideNotice({ id: 'n01_u06', kpis: [] }), '');
  assert.equal(asideNotice(undefined), '');
  assert.equal(asideNotice({ set_aside: null }), '');
});

test('App shows the notice in place of every page view that a set-aside page would otherwise open', () => {
  const app = src('App.jsx');
  assert.match(app, /const aside = asideNotice\(page\);/);
  assert.match(app, /\{!admin && page && aside && <SetAside text=\{aside\} \/>\}/);
  assert.match(app, /if \(page && !aside\) loadMeta\(page\.id\)/, 'a set-aside page asks the App for no filters or defaults');
  const branches = app.match(/\{!admin && page && !aside && /g) || [];
  assert.equal(branches.length, 4, 'performance, agent, plan and the default page each wait for a page that is not set aside');
});

test('the notice renders as a status card with its text', () => {
  const card = src('SetAside.jsx');
  assert.match(card, /data-set-aside=""/);
  assert.match(card, /\{text\}/);
});
