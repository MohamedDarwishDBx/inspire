// P88 round 2: the wizard's First run sentence names the same count as the run's text, for every case in the shared fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { recordGroupsSaid } from '../src/lib/runScope.js';

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('../../agent/tests/fixtures/first_run_count_cases.json', import.meta.url)), 'utf8'));

for (const c of fixture.cases) {
  test(`wizard First run on records names ${c.shown} for ${c.name}`, () => {
    const profile = { table: 'main.sales.tx', records: c.rows, standalone: true };
    const label = recordGroupsSaid(profile, { scope_records: String(c.goal) }).label;
    assert.equal(Number(label.match(/[\d,]+/)[0].replace(/,/g, '')), c.shown, label);
  });
}
