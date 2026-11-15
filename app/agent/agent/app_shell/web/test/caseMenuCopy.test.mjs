// REQ-258 (coordinator, D-NAMES): the use case switcher names each use case by its title. A use case id is never
// rendered as text a person reads; ids stay in the data attributes and keys, which the screen never shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'src', 'CaseMenu.jsx'), 'utf8');
// A JSX text child that is only an id expression, e.g. <small>{item.use_case_id}</small>
const ID_TEXT = />\s*\{[\w.?]*use_case_id\}\s*</;

test('the use case switcher never prints a use case id as text (must-exclude: the sibling subtitle)', () => {
  assert.equal(ID_TEXT.test('<small>{item.use_case_id}</small>'), true, 'positive control: the pattern catches the id subtitle');
  assert.equal(ID_TEXT.test(SRC), false, 'CaseMenu.jsx prints no use case id as text');
});

test('the switcher keeps ids in keys and data attributes, and names each sibling by its title (must-keep)', () => {
  assert.match(SRC, /<b>\{item\.name\}<\/b>/);
  assert.match(SRC, /data-sibling=\{item\.use_case_id\}/);
});
