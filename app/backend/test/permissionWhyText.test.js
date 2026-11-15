// REQ-300 / REQ-313: a permission reason says only WHY. The Permission Required dialog adds its one instruction line, so no entry builder
// may add its own "ask your admin ... then click Try again" sentence (must-exclude, scanned over every producer).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const PRODUCERS = [
  'backend/lib/permissionError.js', 'backend/lib/sourceAccess.js', 'backend/lib/permissions.js', 'backend/lib/inspireImplement.js',
  'backend/implementRoutes.js', 'frontend/src/lib/implementWizard.js', 'frontend/src/pages/ImplementPage.jsx',
];
const REASON_LINE = /\bwhy\s*[:=]|\binstructions\s*:/;
const INSTRUCTION = /admin|try again|check again|\bask (your|an|the|\$\{|data)|re-run/i;

test('no permission reason or note tells the person to ask an admin or to click Try again (REQ-300, must-exclude)', () => {
  const offenders = [];
  for (const rel of PRODUCERS) {
    fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n').forEach((line, i) => {
      if (REASON_LINE.test(line) && INSTRUCTION.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 140)}`);
    });
  }
  assert.deepEqual(offenders, [], offenders.join('\n'));
});

test('the dialog adds the one instruction line itself, so the reasons it shows say why (must-fail: a reason with the phrase is caught)', () => {
  assert.match("why: 'Inspire could not run these grants. Ask your workspace admin to run these commands, then click Try again.'", REASON_LINE);
  assert.match("why: 'Inspire could not run these grants. Ask your workspace admin to run these commands, then click Try again.'", INSTRUCTION);
  assert.doesNotMatch("why: 'Inspire reads this with your own access.'", INSTRUCTION);
});
