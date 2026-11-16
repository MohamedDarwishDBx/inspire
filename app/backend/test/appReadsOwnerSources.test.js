// REQ-301: the App's read dialog never lists a source table a user-authorization App reads directly (only its own views are
// granted to its audience), and a person who owns the object they read never gets a grant for it (the owner by identity id).
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/inspireImplement');

const VIEW = '`inspire_kinds_rc7`.`_inspire_app`.`n01_results__signal`';
const SOURCE = '`inspire_kinds_rc7`.`_inspire`.`sales_transactions`';
const APP = 'app-sp-2';
const OWNER_ID = 'b2b3b070-1da5-45c3-b5b6-81a2feaf85bb';
const OWNER = 'owner@example.com';

function userAppRow() {
  return {
    status: 'ready_with_warnings',
    asset_status: { app: {
      access_mode: 'user', reasons_view: '', views: [`inspire_kinds_rc7._inspire_app.n01_results__signal`],
      sources_read: [`inspire_kinds_rc7._inspire.sales_transactions`],
    } },
    session_id: 42, use_case_id: 'N01-U01', spec_version: 3, app_name: 'inspire-fwa-batch-a-walk-fraud',
    spec_json: '{}',
  };
}

test('REQ-301: a user-authorization App record lists only its own views as objects; a source table it reads directly is not an object to grant', () => {
  const record = I.appReadsRecord([userAppRow()]);
  assert.ok(record, 'the App record is read');
  assert.deepEqual(record.views, ['inspire_kinds_rc7._inspire_app.n01_results__signal']);
  assert.deepEqual(record.sources, ['inspire_kinds_rc7._inspire.sales_transactions']);
  assert.deepEqual(record.tables.map((t) => t.table), ['inspire_kinds_rc7._inspire_app.n01_results__signal'],
    'the source table never reaches the grant list, so no admin SELECT on it is shown or copied');
});

test('REQ-301 owner case: the person who owns the object reads it with no grant, matched by identity id as well as by name', () => {
  // Unity Catalog reports the owner of this table as the account user id, while the person is named by email.
  const rows = [
    { level: 'catalog', privilege: 'OWNER', principal: OWNER_ID, mine: false, me: OWNER },
    { level: 'schema', privilege: 'OWNER', principal: OWNER_ID, mine: false, me: OWNER },
    { level: 'table', privilege: 'OWNER', principal: OWNER_ID, mine: false, me: OWNER },
  ];
  const withoutId = I.accessPlan(VIEW, rows, OWNER, { needs: I.IMPLEMENT_SOURCE_NEEDS });
  assert.ok(withoutId.gaps.length + withoutId.grants.length > 0, 'without the identity id the owner looks unable to read');
  const withId = I.accessPlan(VIEW, rows, OWNER, { needs: I.IMPLEMENT_SOURCE_NEEDS, aliases: [OWNER_ID] });
  assert.deepEqual([...withId.grants, ...withId.gaps], [], 'the owner needs no grant on the object she owns');
});

test('REQ-301 owner case in the dialog: the owner gets no statement, another audience member still gets the view grants', () => {
  const rows = [[
    { level: 'catalog', privilege: 'OWNER', principal: OWNER_ID, mine: false, me: OWNER },
    { level: 'schema', privilege: 'OWNER', principal: OWNER_ID, mine: false, me: OWNER },
    { level: 'table', privilege: 'OWNER', principal: OWNER_ID, mine: false, me: OWNER },
  ]];
  const record = { objects: true, mode: 'user', app_name: 'inspire-fwa-batch-a-walk-fraud', tables: [{ table: VIEW.replace(/`/g, ''), owner: '', grants: [] }] };
  // Other audience member has none of the three objects; the owner (by id) has all three.
  const owned = I.appReadsLeftFor(record, [OWNER], rows, { [OWNER]: [OWNER_ID] });
  assert.deepEqual(owned, [], 'the owner sees no missing grant for her own object');
  const other = I.appReadsLeftFor(record, ['someone@example.com'], rows, {});
  assert.ok(other.length === 1 && other[0].grants.length > 0, 'a person who is not the owner still needs its grants (must-not-exclude)');
  assert.ok(other[0].grants.every((g) => g.includes('someone@example.com')));
});
