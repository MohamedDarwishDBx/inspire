// Business profiles: a named, server-stored copy of the Start form, shared by everyone on the App (D-PROF2A).
// The tables live in the App's own database, next to the launch record. A run started with a profile is linked to it by session.
const { quoted } = require('./launchLedger');

const PROFILE_TABLE = '__inspire_profile';
const LINK_TABLE = '__inspire_profile_link';
const NAME_MAX = 120;
const SPEC_MAX_CHARS = 200000;
const LIST_LIMIT = 200;
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;

const clean = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');

function profilesTable(appDatabase) {
  return quoted(appDatabase, PROFILE_TABLE);
}

function linksTable(appDatabase) {
  return quoted(appDatabase, LINK_TABLE);
}

function isProfileId(value) {
  return ID_RE.test(String(value ?? ''));
}

// The one check a save passes through: a name, the form's settings and an optional business name. Returns { error } or the clean values.
function profileToSave(body) {
  const source = body && typeof body === 'object' ? body : {};
  const name = clean(source.name);
  if (!name) return { error: 'Give the profile a name' };
  if (name.length > NAME_MAX) return { error: `The profile name can be at most ${NAME_MAX} characters` };
  const spec = source.spec;
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return { error: 'The profile needs the settings of the form' };
  const specJson = JSON.stringify(spec);
  if (specJson.length > SPEC_MAX_CHARS) return { error: 'These settings are too large to save as a profile' };
  const businessName = clean(source.business_name ?? (spec.params && spec.params['00_business_name']));
  return { name, businessName, specJson, overwrite: source.overwrite === true };
}

function createProfileSql(table) {
  return `CREATE TABLE IF NOT EXISTS ${table} (profile_id STRING, name STRING, business_name STRING, spec_json STRING, `
    + 'created_by STRING, created_at TIMESTAMP, updated_by STRING, updated_at TIMESTAMP)';
}

function createLinkSql(table) {
  return `CREATE TABLE IF NOT EXISTS ${table} (session_id STRING, inspire_database STRING, profile_id STRING, linked_by STRING, linked_at TIMESTAMP)`;
}

const str = (name, value) => ({ name, value: String(value ?? ''), type: 'STRING' });

function findByNameStatement(table, name) {
  return {
    sql: `SELECT profile_id FROM ${table} WHERE lower(name) = lower(:name) LIMIT 1`,
    parameters: [str('name', name)],
  };
}

function getStatement(table, profileId) {
  if (!isProfileId(profileId)) return null;
  return {
    sql: `SELECT profile_id, name, business_name, spec_json, created_by, created_at, updated_by, updated_at FROM ${table} WHERE profile_id = :profile_id LIMIT 1`,
    parameters: [str('profile_id', profileId)],
  };
}

function listStatement(table, businessName = '') {
  const business = clean(businessName);
  return {
    sql: `SELECT profile_id, name, business_name, created_by, created_at, updated_by, updated_at FROM ${table}`
      + (business ? ' WHERE lower(business_name) = lower(:business_name)' : '')
      + ` ORDER BY updated_at DESC LIMIT ${LIST_LIMIT}`,
    parameters: business ? [str('business_name', business)] : [],
  };
}

function insertStatement(table, { profileId, name, businessName, specJson, by }) {
  return {
    sql: `INSERT INTO ${table} (profile_id, name, business_name, spec_json, created_by, created_at, updated_by, updated_at) `
      + 'VALUES (:profile_id, :name, :business_name, :spec_json, :by, current_timestamp(), :by, current_timestamp())',
    parameters: [str('profile_id', profileId), str('name', name), str('business_name', businessName), str('spec_json', specJson), str('by', by)],
  };
}

function overwriteStatement(table, { profileId, name, businessName, specJson, by }) {
  return {
    sql: `UPDATE ${table} SET name = :name, business_name = :business_name, spec_json = :spec_json, updated_by = :by, updated_at = current_timestamp() `
      + 'WHERE profile_id = :profile_id',
    parameters: [str('profile_id', profileId), str('name', name), str('business_name', businessName), str('spec_json', specJson), str('by', by)],
  };
}

function linkInsertStatement(table, { inspireDatabase, sessionId, profileId, by }) {
  return {
    sql: `INSERT INTO ${table} (session_id, inspire_database, profile_id, linked_by, linked_at) `
      + 'VALUES (:session_id, :inspire_database, :profile_id, :by, current_timestamp())',
    parameters: [str('session_id', sessionId), str('inspire_database', String(inspireDatabase || '').trim().toLowerCase()), str('profile_id', profileId), str('by', by)],
  };
}

// The newest profile link of each listed session, with the profile's name. Empty when no session is listed.
function linksOfSessionsStatement(links, profiles, inspireDatabase, sessionIds) {
  const ids = [...new Set((sessionIds || []).map((id) => String(id)).filter(Boolean))];
  if (!ids.length) return null;
  return {
    sql: `SELECT CAST(l.session_id AS STRING) AS session_id, l.profile_id AS profile_id, p.name AS profile_name FROM ${links} l `
      + `JOIN ${profiles} p ON p.profile_id = l.profile_id WHERE l.inspire_database = :inspire_database `
      + `AND CAST(l.session_id AS STRING) IN (${ids.map((_, i) => `:s${i}`).join(', ')}) ORDER BY l.linked_at DESC`,
    parameters: [str('inspire_database', String(inspireDatabase || '').trim().toLowerCase()), ...ids.map((id, i) => str(`s${i}`, id))],
  };
}

// The list and the Download read the same fields: who saved the profile last, and when.
function profileSummary(row) {
  return {
    profile_id: String(row.profile_id),
    name: String(row.name || ''),
    business_name: String(row.business_name || ''),
    saved_by: String(row.updated_by || row.created_by || ''),
    saved_at: row.updated_at || row.created_at || null,
  };
}

function profileDetail(row) {
  let spec = null;
  try {
    spec = JSON.parse(row.spec_json || 'null');
  } catch {
    spec = null;
  }
  return { ...profileSummary(row), spec: spec && typeof spec === 'object' && !Array.isArray(spec) ? spec : {} };
}

// Sets profile_id and profile_name on each listed session from its newest link (rows arrive newest first).
function withProfiles(sessions, linkRows) {
  const byId = new Map();
  for (const row of linkRows || []) {
    const sid = String(row.session_id);
    if (!byId.has(sid)) byId.set(sid, { profile_id: String(row.profile_id), profile_name: String(row.profile_name || '') });
  }
  for (const session of sessions) {
    const found = byId.get(String(session.session_id));
    if (found) Object.assign(session, found);
  }
  return sessions;
}

module.exports = {
  PROFILE_TABLE,
  LINK_TABLE,
  NAME_MAX,
  profilesTable,
  linksTable,
  isProfileId,
  profileToSave,
  createProfileSql,
  createLinkSql,
  findByNameStatement,
  getStatement,
  listStatement,
  insertStatement,
  overwriteStatement,
  linkInsertStatement,
  linksOfSessionsStatement,
  profileSummary,
  profileDetail,
  withProfiles,
};
