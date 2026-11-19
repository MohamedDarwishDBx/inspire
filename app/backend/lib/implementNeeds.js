// The privilege needs of Inspire's reads, in one place. Both the App's Permission Required dialogs (permissions.js) and the access
// checks (inspireImplement.js) read these lists. This module has no requires, so neither side can load a partial copy of the other.

// A person's reads of a table: USE CATALOG, USE SCHEMA and SELECT.
const IMPLEMENT_READ_NEEDS = [
  ['USE CATALOG', 'catalog', ['catalog']],
  ['USE SCHEMA', 'schema', ['catalog', 'schema']],
  ['SELECT', 'table', ['catalog', 'schema', 'table']],
];
const IMPLEMENT_TRAVERSE_PRIVILEGES = IMPLEMENT_READ_NEEDS.filter(([, level]) => level !== 'table').map(([privilege]) => privilege);
// The App's ABAC policy read (GET /api/2.1/unity-catalog/policies/table) needs READ METADATA on the table. Docs: manage-privileges/privileges,
// READ METADATA: "Row filters and column masks ... Attribute-based access control (ABAC) policies"; BROWSE does not expose them.
const IMPLEMENT_ABAC_READ_NEEDS = [['READ METADATA', 'table', ['catalog', 'schema', 'table']]];
// Unity Catalog privileges: ALL PRIVILEGES does not include READ METADATA, and BROWSE and MANAGE do not confer it. Only a READ METADATA
// grant on the table, its schema or its catalog covers the App's policy read.
const IMPLEMENT_NOT_IN_ALL_PRIVILEGES = ['READ METADATA'];
// What the App's source check needs: the read needs and the ABAC read.
const IMPLEMENT_SOURCE_NEEDS = [...IMPLEMENT_READ_NEEDS, ...IMPLEMENT_ABAC_READ_NEEDS];

module.exports = { IMPLEMENT_READ_NEEDS, IMPLEMENT_TRAVERSE_PRIVILEGES, IMPLEMENT_ABAC_READ_NEEDS, IMPLEMENT_NOT_IN_ALL_PRIVILEGES,
  IMPLEMENT_SOURCE_NEEDS };
