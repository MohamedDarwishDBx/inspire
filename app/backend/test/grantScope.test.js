// REQ-408: read grants are asked at the level the person picked (schema by default, catalog for a whole-catalog pick).
// Write privileges and non-UC steps stay exact.
const test = require('node:test');
const assert = require('node:assert/strict');
const { coarseGrants } = require('../lib/grantScope');

const P = '`p@example.com`';
const T = (n) => `GRANT SELECT ON TABLE \`main\`.\`s\`.\`t${n}\` TO ${P}`;
const M = (n) => `GRANT READ METADATA ON TABLE \`main\`.\`s\`.\`t${n}\` TO ${P}`;
const USE_CAT = `GRANT USE CATALOG ON CATALOG \`main\` TO ${P}`;
const USE_SCH = `GRANT USE SCHEMA ON SCHEMA \`main\`.\`s\` TO ${P}`;

test('ten tables in one schema collapse to one SELECT on the schema, with USE CATALOG and USE SCHEMA once', () => {
  const tables = Array.from({ length: 10 }, (_, i) => T(i));
  assert.deepEqual(coarseGrants([USE_CAT, USE_SCH, ...tables]), [
    USE_CAT,
    USE_SCH,
    `GRANT SELECT ON SCHEMA \`main\`.\`s\` TO ${P}`,
  ]);
});

test('READ METADATA on tables collapses to one READ METADATA on the schema', () => {
  const out = coarseGrants([USE_CAT, USE_SCH, T(1), M(1), M(2)]);
  assert.deepEqual(out, [USE_CAT, USE_SCH, `GRANT SELECT ON SCHEMA \`main\`.\`s\` TO ${P}`, `GRANT READ METADATA ON SCHEMA \`main\`.\`s\` TO ${P}`]);
});

test('a whole-catalog pick asks at catalog level and drops the schema and table lines under it', () => {
  const out = coarseGrants([USE_CAT, USE_SCH, T(1), M(1), `GRANT SELECT ON SCHEMA \`main\`.\`s\` TO ${P}`], { wholeCatalogs: ['main'] });
  assert.deepEqual(out, [USE_CAT, `GRANT SELECT ON CATALOG \`main\` TO ${P}`, `GRANT READ METADATA ON CATALOG \`main\` TO ${P}`]);
});

test('a whole-catalog pick adds USE CATALOG when only table reads were named', () => {
  assert.deepEqual(coarseGrants([T(1)], { wholeCatalogs: ['main'] }), [`GRANT USE CATALOG ON CATALOG \`main\` TO ${P}`, `GRANT SELECT ON CATALOG \`main\` TO ${P}`]);
});

test('a catalog that is not picked whole stays at schema level', () => {
  assert.deepEqual(coarseGrants([USE_CAT, USE_SCH, T(1)], { wholeCatalogs: ['other'] }), [USE_CAT, USE_SCH, `GRANT SELECT ON SCHEMA \`main\`.\`s\` TO ${P}`]);
});

test('write privileges stay exact at table level (must-keep)', () => {
  const modify = `GRANT MODIFY ON TABLE \`main\`.\`s\`.\`t1\` TO ${P}`;
  assert.deepEqual(coarseGrants([modify, T(1)]), [modify, `GRANT SELECT ON SCHEMA \`main\`.\`s\` TO ${P}`]);
});

test('non-UC steps and other write grants pass through unchanged (must-keep)', () => {
  const create = `GRANT CREATE TABLE ON SCHEMA \`main\`.\`s\` TO ${P}`;
  const warehouse = `GRANT CAN_USE ON WAREHOUSE \`w\` TO ${P}`;
  assert.deepEqual(coarseGrants([create, warehouse]), [create, warehouse]);
});

test('a Lakebase (Postgres) statement with double quotes is not a Unity Catalog name and passes through (must-keep)', () => {
  const pg = 'GRANT SELECT ON TABLE "app"."orders", "app"."items" TO "client_id"';
  assert.deepEqual(coarseGrants([pg]), [pg]);
});

test('each principal gets its own coarse lines', () => {
  const other = '`q@example.com`';
  const out = coarseGrants([T(1), `GRANT SELECT ON TABLE \`main\`.\`s\`.\`t1\` TO ${other}`]);
  assert.deepEqual(out, [`GRANT SELECT ON SCHEMA \`main\`.\`s\` TO ${P}`, `GRANT SELECT ON SCHEMA \`main\`.\`s\` TO ${other}`]);
});

test('the normaliser is idempotent: coarse input comes back unchanged', () => {
  const once = coarseGrants([USE_CAT, USE_SCH, T(1), T(2), M(1)], { wholeCatalogs: [] });
  assert.deepEqual(coarseGrants(once), once);
});

// The shared fixture: the Python mirror (shell_core.coarse_grants, the App shell) must return the same statements for every case.
test('the shared fixture: every case returns its expected statements, and coarse input is returned unchanged', () => {
  const cases = require('./support/grantScopeCases.json');
  for (const c of cases) {
    assert.deepEqual(coarseGrants(c.input, { wholeCatalogs: c.wholeCatalogs }), c.expected, c.name);
    if (c.idempotent) assert.deepEqual(coarseGrants(c.expected, { wholeCatalogs: c.wholeCatalogs }), c.expected, `${c.name} (idempotent)`);
  }
});
