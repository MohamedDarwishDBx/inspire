// REQ-387: Inspire's own tables and views never appear in the person's data lists (Data Management column search, relationships).
// One rule (frontend/src/lib/inspireOwnObjects.js); the SQL predicate it emits must agree with the JS rule name by name.
const test = require('node:test');
const assert = require('node:assert/strict');
const { isInspireOwnName, notInspireOwnSql, OWN_TABLE_PATTERN, OWN_SCHEMA_PATTERN } = require('../../frontend/src/lib/inspireOwnObjects.js');
const DM = require('../lib/dataManagement');
const R = require('../lib/relationships');

// Real names (names only, as the live schemas list them). Schemas and catalog are the scratch ones the walks used.
const OWN = [
  'main.s.__inspire_usecases',
  'main.s.__inspire_control_log',
  'main.s.__inspire_app_feedback_abc123',
  'main.s._ailogs',
  'main.s._inspire_sales_orders_s42',
  'main._inspire.inspire_kinds_rc7__inspire_sales_transactions__n01_u02__implement_scope',
  'main._inspire.inspire_kinds_rc7__inspire_sales_transactions__n01_u02__implement_scope__v10',
  'main._inspire.inspire_kinds_rc7__inspire_sales_transactions__n01_u02_s42__implement_scope__candidate',
  'main._inspire.inspire_kinds_rc7__inspire_sales_transactions__n01_u02_s42__implement_scope__candidate__v3',
  'main._inspire_e2e_walk_n01_u01.n01_u01_results',
  'main._inspire_e2e_walk_n01_u01.n01_u01_results__lb_signal',
  'main._inspire_happy_path_bakehouse_2_n01_u01.n01_u01_results__peers',
];
// The person's own data, the sample copies the App makes, and plain tables in the Inspire schema.
const CUSTOMER = [
  'sales_transactions', 'scope', 'customer_scope', 'orders__signal', 'orders_implement_scope', 'implement_scope_log', 'inspire_notes',
  '__inspire', 'signal', 'bakehouse__sales_transactions', 'main.inspire.bakehouse__sales_transactions', 'main._inspire.sales_transactions',
  'main._inspire.nyctaxi__trips', 'walk_rc7e.bakehouse_sales_transactions',
];

test('Inspire creates tables and views named by the one rule, and a person table of a similar name is never hidden (REQ-387)', () => {
  for (const name of OWN) assert.equal(isInspireOwnName(name), true, `${name} is Inspire's own`);
  for (const name of CUSTOMER) assert.equal(isInspireOwnName(name), false, `${name} is the person's data and must stay listed`);
});

// The emitted predicate is evaluated here for the same names: an RLIKE on the lower-cased name, the same pattern the JS rule tests.
function predicateKeeps(sql, tableName, schemaName = '') {
  const match = /^NOT \((.*)\)$/.exec(sql.trim());
  assert.ok(match, 'the predicate is NOT (...)');
  const hidden = [...match[1].matchAll(/lower\(([a-z_.]+)\) RLIKE '([^']*)'/g)].some(([, column, pattern]) => {
    const value = column.endsWith('schema') ? schemaName : tableName;
    return new RegExp(pattern).test(value.toLowerCase());
  });
  return !hidden;
}

test('the SQL predicate hides exactly the names the JS rule hides (REQ-387)', () => {
  const sql = notInspireOwnSql('c.table_name', 'c.table_schema');
  for (const full of [...OWN, ...CUSTOMER]) {
    const parts = full.split('.');
    const table = parts.pop();
    const schema = parts.pop() || '';
    assert.equal(predicateKeeps(sql, table, schema), !isInspireOwnName(full), `SQL and JS agree on ${full}`);
  }
  assert.equal(OWN_TABLE_PATTERN.includes("'") || OWN_TABLE_PATTERN.includes('\\'), false, 'the pattern needs no SQL quoting or escape');
  assert.equal(OWN_SCHEMA_PATTERN, '^_inspire_');
});

test('column search and relationships read Inspire-free tables only, by table and schema (REQ-387)', () => {
  const [search] = DM.columnSearchStatements({ schemas: [['main', 's'].join('.')] }, 'id');
  assert.match(search.statement.sql, /NOT \(lower\(c\.table_name\) RLIKE '\^__\?inspire_/, 'the search predicate hides Inspire tables');
  assert.match(search.statement.sql, /lower\(c\.table_schema\) RLIKE '\^_inspire_'/, 'the search predicate hides Inspire use case schemas');
  const columns = R.scopeColumnsStatement('main', ['main.s.orders']);
  assert.match(columns.sql, /NOT \(lower\(table_name\) RLIKE '\^__\?inspire_/, 'the relationships column read hides Inspire tables');
  assert.match(columns.sql, /lower\(table_schema\) RLIKE '\^_inspire_'/, 'the relationships column read hides Inspire schemas');
  const keys = R.scopeKeysStatement('main', ['main.s.orders']);
  assert.match(keys.sql, /NOT \(lower\(kcu\.table_name\) RLIKE '\^__\?inspire_/, 'the relationships key read hides Inspire tables');
  assert.match(keys.sql, /lower\(kcu\.table_schema\) RLIKE '\^_inspire_'/, 'the relationships key read hides Inspire schemas');
});
