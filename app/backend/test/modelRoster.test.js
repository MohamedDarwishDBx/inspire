// REQ-405: the App's model roster order is the agent's: the same family table, versions and exclusions as the bundled notebook.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { LLM_FAMILY_SPECS, versionOf, rosterOrder } = require('../lib/modelRoster');

const CASES = JSON.parse(fs.readFileSync(path.join(__dirname, 'support', 'modelRosterCases.json'), 'utf8'));
const NOTEBOOK = path.join(__dirname, '..', '..', 'agent', 'agent', 'dbx_inspire_ai_agent.ipynb');

// The family table as the notebook spells it: the tuples of LLM_FAMILY_SPECS in cell 1, first two fields.
function notebookFamilySpecs() {
  const cells = JSON.parse(fs.readFileSync(NOTEBOOK, 'utf8')).cells;
  const source = [].concat(cells[1].source).join('');
  const block = source.slice(source.indexOf('LLM_FAMILY_SPECS = ('));
  const body = block.slice(0, block.indexOf('\n)'));
  return [...body.matchAll(/\(\s*r?"([^"]*)",\s*r?"([^"]*)",/g)].map((m) => [m[1], m[2]]);
}

test('the family table matches the bundled notebook, row for row', () => {
  assert.deepEqual(LLM_FAMILY_SPECS, notebookFamilySpecs());
});

test('the roster order matches the notebook own family functions on the shared fixture', () => {
  assert.deepEqual(rosterOrder(CASES.endpoints), CASES.expected);
});

test('an embedding model, a model that is not ready, an empty served endpoint and a name outside every family are never in the order', () => {
  const order = rosterOrder(CASES.endpoints);
  for (const name of ['databricks-bge-large-en', 'databricks-claude-sonnet-4-7', 'acme-empty', 'acme-vision']) {
    assert.ok(!order.includes(name), `${name} must not be in the roster order`);
  }
  assert.ok(order.includes('acme-external-claude'), 'an external model that serves a family model is in its family');
});

test('versions compare as numbers, newest first', () => {
  assert.deepEqual(versionOf('databricks-claude-sonnet-4-10'), [4, 10, 0]);
  assert.deepEqual(rosterOrder([{ name: 'databricks-claude-sonnet-4-9', task: 'llm/v1/chat' }, { name: 'databricks-claude-sonnet-4-10', task: 'llm/v1/chat' }]),
    ['databricks-claude-sonnet-4-10', 'databricks-claude-sonnet-4-9']);
});
