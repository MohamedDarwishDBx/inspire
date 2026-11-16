// REQ-387: Inspire's own tables and views never appear in the person's data lists (Data Management column search, relationships).
// One rule (frontend/src/lib/inspireOwnObjects.js); the SQL predicate it emits must agree with the JS rule name by name.
const test = require('node:test');
const assert = require('node:assert/strict');
const { isInspireOwnName, notInspireOwnSql } = require('../../frontend/src/lib/inspireOwnObjects.js');
const DM = require('../lib/dataManagement');
const R = require('../lib/relationships');

const OWN = ['__inspire_usecases', '__inspire_control_log', '__inspire_profile', '_ailogs', 'orders__implement_scope', 'orders__signal',
  'main.s.__inspire_session'];
const CUSTOMER = ['sales', 'scope', 'customer_scope', 'inspire_notes', '__inspire', 'orders_implement_scope', 'signal', 'implement_scope_log'];

test('Inspire creates tables and views named by the one rule, and a person table of a similar name is never hidden (REQ-387)', () => {
  for (const name of OWN) assert.equal(isInspireOwnName(name), true, `${name} is Inspire's own`);
  for (const name of CUSTOMER) assert.equal(isInspireOwnName(name), false, `${name} is the person's data and must stay listed`);
});

// The emitted predicate is evaluated here for the same names: a LIKE with the '!' escape, an exact name, and NOT(OR ...).
function predicateKeeps(sql, name) {
  const match = /NOT \((.*)\)$/.exec(sql.trim());
  assert.ok(match, 'the predicate is NOT (...)');
  const clauses = match[1].split(' OR ');
  const hidden = clauses.some((clause) => {
    const like = /LIKE '([^']*)' ESCAPE '!'/.exec(clause);
    if (like) {
      const re = like[1].replace(/!_|!%|%|_|[.*+?^${}()|[\]\\]/g, (t) => (t === '!_' ? '_' : t === '!%' ? '%' : t === '%' ? '.*' : t === '_' ? '.' : `\\${t}`));
      return new RegExp(`^${re}$`).test(name);
    }
    const eq = /= '([^']*)'/.exec(clause);
    return eq ? name === eq[1] : false;
  });
  return !hidden;
}

test('the SQL predicate hides exactly the names the JS rule hides (REQ-387)', () => {
  const sql = notInspireOwnSql('c.table_name');
  // The predicate runs on the plain table_name column, so only plain names reach it (a full name is split by the JS rule only).
  for (const name of [...OWN, ...CUSTOMER].filter((n) => !n.includes('.'))) {
    assert.equal(predicateKeeps(sql, name), !isInspireOwnName(name), `SQL and JS agree on ${name}`);
  }
});

test('column search and relationships read Inspire-free tables only (REQ-387)', () => {
  const [search] = DM.columnSearchStatements({ schemas: [['main', 's'].join('.')] }, 'id');
  assert.match(search.statement.sql, /NOT \(lower\(c\.table_name\) LIKE '!_!_inspire!_%' ESCAPE '!'/, 'the search predicate hides Inspire tables');
  const columns = R.scopeColumnsStatement('main', ['main.s.orders']);
  assert.match(columns.sql, /NOT \(lower\(table_name\) LIKE '!_!_inspire!_%'/, 'the relationships column read hides Inspire tables');
  const keys = R.scopeKeysStatement('main', ['main.s.orders']);
  assert.match(keys.sql, /NOT \(lower\(kcu\.table_name\) LIKE '!_!_inspire!_%'/, 'the relationships key read hides Inspire tables');
});
