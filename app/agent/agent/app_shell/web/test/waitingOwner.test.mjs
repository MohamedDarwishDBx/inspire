import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'src', 'WaitingForAccess.jsx'), 'utf8');

test('the waiting view names the owner the server returns, and falls back to your data owner when none is known (REQ-040)', () => {
  // REQ-310/311: the owner sentence lives in the dialog's reason line (WaitingForAccess), built from waitingAskOf.
  assert.match(source, /waitingAskOf\(waiting\?\.owners\)/);
  assert.match(source, /\$\{WAITING_REASON\} \$\{waitingAskOf\(waiting\?\.owners\)\}/);
  assert.doesNotMatch(source, /Ask \{owner\}/, 'the view no longer builds the ask sentence itself');
  assert.doesNotMatch(source, /WAITING_OWNER/, 'the generic owner lives in plainText.js with the rest of the owner wording');
});

test('the App root and the Home hub show the one waiting view for a refused read, and never the generic start-up error (REQ-040)', () => {
  const app = readFileSync(join(here, '..', 'src', 'App.jsx'), 'utf8');
  assert.match(app, /error\.code === WAITING_FOR_ACCESS_CODE \? <WaitingForAccess waiting=\{error\.detail\} onCheck=\{boot\} \/>/);
  assert.match(app, /\{!admin && !page && hubWaiting && <WaitingForAccess waiting=\{hubWaiting\.detail\} onCheck=\{loadHub\} \/>\}/);
  assert.match(app, /\.catch\(\(e\) => \{ if \(mine === seq\.current\) setError\(e\); \}\);/, 'the hub keeps the error object, so its code survives');
});

test('the waiting view carries the one access action (grant with my permissions, copy the SQL, check again), not its own button (REQ-082)', () => {
  // REQ-310/311/313: the one access action is PermissionDialog's AccessActions (inside Advanced); WaitingForAccess only wraps the dialog.
  const dialog = readFileSync(join(here, '..', 'src', 'PermissionDialog.jsx'), 'utf8');
  const view = readFileSync(join(here, '..', 'src', 'WaitingForAccess.jsx'), 'utf8');
  assert.match(dialog, /<AccessActions access=\{given\} onFound=\{setOwn\} \/>/);
  assert.doesNotMatch(view, /AccessActions|data-check-again/, 'the view has no access action or Check again button of its own');
});

test('Runs, Records, Alerts and Genie show the same waiting component when their read is refused (REQ-040, one implementation)', () => {
  for (const name of ['Records.jsx', 'Alerts.jsx', 'Genie.jsx', 'Freshness.jsx']) {
    const text = readFileSync(join(here, '..', 'src', name), 'utf8');
    assert.match(text, /waitingOf/, `${name} keeps the waiting state of its refused read`);
  }
  assert.match(readFileSync(join(here, '..', 'src', 'Runs.jsx'), 'utf8'), /const \{ data, error, waiting, busy \} = runs;/, 'Runs reads the waiting state from its runs hook');
  for (const name of ['Runs.jsx', 'Records.jsx', 'Alerts.jsx', 'Genie.jsx']) {
    const text = readFileSync(join(here, '..', 'src', name), 'utf8');
    assert.match(text, /<WaitingForAccess [^>]*compact/, `${name} renders the waiting component compact`);
    assert.doesNotMatch(text, /WAITING_FOR_ACCESS_TITLE|waiting-access--/, `${name} does not restyle the waiting view itself`);
  }
});
