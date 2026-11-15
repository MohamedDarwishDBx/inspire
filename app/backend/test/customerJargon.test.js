// REQ-059: customer copy never carries an internal term (run bookkeeping numbers, prompt keys, Inspire's own tables, log tags,
// and the discovery mode name on run output). The term list is shared with the notebook gate (agent/tests/unit/customer_jargon_test.py).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '..', '..');
const SRC = path.join(APP, 'frontend', 'src');
const spec = JSON.parse(fs.readFileSync(path.join(APP, 'agent', 'tests', 'fixtures', 'customer_jargon_terms.json'), 'utf8'));
const TERMS = spec.terms.map((term) => ({ ...term, re: new RegExp(term.pattern, term.flags) }));
const RUN_OUTPUT = new Set(spec.run_output_files.map((file) => path.join(SRC, file)));
// A literal that is SQL is code, never copy. Copy is any literal with a space, plus JSX text.
const SQL = /^\s*(SELECT|INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|WITH|SHOW|DESCRIBE)\b|\bFROM\b/i;
const LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\\n]|\\.)*)`/g;
const JSX_TEXT = />([^<>{}]*[A-Za-z][^<>{}]*)</g;

function customerTexts(source) {
  const out = [];
  source.split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    for (const m of line.matchAll(LITERAL)) {
      const text = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, ' ');
      if (/\s/.test(text) && !SQL.test(text)) out.push({ line: i + 1, text });
    }
    for (const m of line.matchAll(JSX_TEXT)) out.push({ line: i + 1, text: m[1] });
  });
  return out;
}

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.jsx?$/.test(entry.name) ? [full] : [];
  });
}

test('the shared term list loads and every term is a working pattern', () => {
  assert.ok(TERMS.length >= 5);
  for (const term of TERMS) assert.ok(term.id && term.why, `${term.id} says why it is banned`);
});

test('positive controls: the terms catch the strings a customer saw on rc7 (must-exclude fixtures)', () => {
  const caught = (text) => TERMS.some((term) => term.re.test(text));
  assert.equal(caught('Filter Business Tables batch 1 depth0 attempt1'), true);
  assert.equal(caught('Selecting Business Tables'), false, 'plain step titles pass (must-include)');
  assert.equal(caught('Inspire is working on FILTER_BUSINESS_TABLES_PROMPT now'), true);
  assert.equal(caught('Read it from __inspire_session'), true);
  assert.equal(caught('Ask Genie about N06-U01'), true, 'REQ-258: a bare use case id fails (must-exclude)');
  assert.equal(caught('Genie Agent "Merge Duplicate Customer Records" when it needs the data'), false, 'the use case by its title passes (must-keep)');
  assert.equal(caught('Skip __constraints'), true, 'a bare internal object name fails (must-exclude)');
  assert.equal(caught('the table main.inspire.demand_out__series does not exist'), false, 'a qualified table name passes (must-keep)');
  assert.equal(caught('[DATA-FILTER-LABEL FIRED] 12 of 12 names carried the label'), true);
  assert.equal(caught('<bound method Series.prod of inspire_group 0 1 Name: 165, dtype: object>'), true, 'REQ-249 repr fails (must-exclude)');
  assert.equal(caught('Average transaction value rose 12% to 340 USD over the last 30 days.'), false, 'a plain sentence passes (must-keep)');
  const mode = TERMS.find((term) => term.id === 'mode_name_on_run_output');
  assert.equal(mode.re.test('AI Enhanced Discovery: the AI sees the summary figures'), true);
  assert.equal(mode.re.test('Discovery: the AI sees the summary figures'), false, 'the plain Discovery label is fine (must-include)');
});

test('no customer copy in the frontend carries an internal term', () => {
  const hits = sources(SRC).flatMap((file) => customerTexts(fs.readFileSync(file, 'utf8')).flatMap(({ line, text }) => TERMS
    .filter((term) => (term.scope === 'run_output' ? RUN_OUTPUT.has(file) : true) && term.re.test(text))
    .map((term) => `${path.relative(APP, file)}:${line} [${term.id}] ${text.trim()}`)));
  assert.deepEqual(hits, []);
});

test('run output never interpolates the discovery mode name into its copy (the dynamic form of the same defect)', () => {
  const forbidden = spec.run_output_forbidden_interpolations.map((pattern) => new RegExp(pattern));
  const hits = [...RUN_OUTPUT].flatMap((file) => fs.readFileSync(file, 'utf8').split('\n')
    .map((line, i) => (forbidden.some((re) => re.test(line)) ? `${path.relative(APP, file)}:${i + 1}: ${line.trim()}` : ''))
    .filter(Boolean));
  assert.deepEqual(hits, []);
  assert.ok(forbidden.some((re) => re.test('<span>{access.type}: no data read.</span>')), 'positive control: the rc7 copy is caught');
});

// Backend user-facing text: error messages, refusals and warnings the App shows. Log calls and SQL are not copy.
const BACKEND_LOG = /\b(console\.|logger\.|log\(|log_print)/;
const BACKEND_SRC = path.join(APP, 'backend');
const backendFiles = () => fs.readdirSync(BACKEND_SRC, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(BACKEND_SRC, entry.name);
  if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === 'test' ? [] : backendFiles.dirOf(full);
  return /\.js$/.test(entry.name) ? [full] : [];
});
backendFiles.dirOf = (dir) => sources(dir).filter((file) => !file.includes(`${path.sep}test${path.sep}`) && !file.includes('node_modules'));

test('no backend message the App shows carries an internal term (the log tag is dropped first, as the App sees it)', () => {
  const hits = backendFiles().flatMap((file) => fs.readFileSync(file, 'utf8').split('\n')
    .flatMap((line, i) => (BACKEND_LOG.test(line) ? [] : customerTexts(line).map(({ text }) => ({ text, i }))))
    // A quoted SQL identifier (`catalog`.`schema`.`__inspire_session`) is code the warehouse reads, never copy.
    .filter(({ text }) => !/\\?`\.|\.\\?`/.test(text))
    .map(({ text, i }) => {
      const copy = text.replace(/^\[[A-Z0-9_ -]+ FIRED\]\s*/, '');
      // the mode name is run-output only: the chooser's own validation text may name the modes
      const id = TERMS.find((term) => term.scope !== 'run_output' && term.re.test(copy));
      return id ? `${path.relative(APP, file)}:${i + 1} [${id.id}] ${copy.trim().slice(0, 120)}` : '';
    }).filter(Boolean));
  assert.deepEqual(hits, []);
});
