const I = require('./inspireImplement');
const P = require('./requestPerson');
const { parseExactJson } = require('./exactJson');
const { redactSecrets } = require('./redact');
const { permissionRequired } = require('./permissions');

// REQ-418: the ABAC policy read (the same read REQ-417 checks READ METADATA with) says whether a table has a row filter or a column mask.
// Only those tables need the per-user identity choice in the build wizard, so the policy body is read once, here, for both answers.
function policiesOf(body) {
  const data = body && typeof body === 'object' ? body : {};
  const listed = Array.isArray(data.policies) ? data.policies : [];
  return listed.length > 0 || Boolean(data.row_filter) || (Array.isArray(data.column_masks) && data.column_masks.length > 0);
}

function policyPath(table) {
  return `/api/2.1/unity-catalog/policies/table/${encodeURIComponent(table)}`;
}


function createSourceAccess({ executeSql, sqlResultToObjects, dbFetch, appToken = async () => '', logger = console }) {
  const sqlRows = async (host, token, warehouseId, statement) =>
    sqlResultToObjects(await executeSql(host, token, warehouseId, statement.sql, statement.parameters));

  async function appIdentity(req, token) {
    let me = {};
    try {
      const resp = await dbFetch(req.dbHost, token, P.SCIM_ME_PATH);
      me = resp.ok ? parseExactJson((await resp.text()) || '{}') : {};
    } catch {
      me = {};
    }
    const id = String(me.applicationId || me.userName || '').trim();
    return { name: String(me.displayName || '').trim() || id, id };
  }

  const accessRowsOf = (req, token, warehouseId, table) => Promise.resolve()
    .then(() => sqlRows(req.dbHost, token, warehouseId, I.outputAccessStatement(table)))
    .catch(() => []);

  // Run-as-me: the App acts as the person, so its reads use the person's forwarded token (never an App token).
  // REQ-418: the App's service principal token, the one every read uses. The request's own App-identity token stands in when no separate one is
  // configured; a person's token never does.
  const appTokenOf = async (req) => (await appToken()) || (req && req.dbTokenKind !== P.PERSON_TOKEN ? req.dbToken || '' : '');

  // { unreadable, policied }: whether the App could read the table's ABAC policies, and whether the table has a row filter or column mask.
  async function abacRead(req, app, table) {
    try {
      const resp = await dbFetch(req.dbHost, app, policyPath(table));
      if (resp.status === 404) return { unreadable: false, policied: false };
      if (resp.ok) {
        const body = parseExactJson((await resp.text()) || '{}');
        return { unreadable: false, policied: policiesOf(body) };
      }
      const body = await resp.text().catch(() => '');
      logger.warn(`[SOURCE-ACCESS] the App could not read the ABAC policies of ${table} (HTTP ${resp.status}): ${redactSecrets(body).slice(0, 300)}`);
      return { unreadable: true, policied: false };
    } catch (error) {
      logger.warn(`[SOURCE-ACCESS] the App could not read the ABAC policies of ${table}: ${redactSecrets(String((error && error.message) || error)).slice(0, 300)}`);
      return { unreadable: true, policied: false };
    }
  }

  function unverifiedOffer(tables) {
    return { tables, app: { name: '', id: '' }, grants: [], can_grant: false, builtin: [],
      text: 'Inspire cannot check what the App can read right now, so the build waits. Try again in a moment' };
  }

  // REQ-418: what the App's service principal can read of the tables, and which of them carry a row filter or column mask. Every read is the
  // App's own; a person's grants are never asked. The person's sign-in is used only to run a grant (grantSourceAccess, appReads).
  // REQ-408: `scope.wholeCatalogs` are the catalogs the run picked whole; the offer's dialog asks at catalog level for them.
  async function sourceAccess(req, warehouseId, tables, job = 'build', scope = {}) {
    const app = await appTokenOf(req);
    if (!app) return { missing: [], policied: [], app_unreadable: unverifiedOffer(tables) };
    // REQ-324: the probes and the policy reads are independent of each other, so they run together, not one after another.
    const [probes, reads] = await Promise.all([
      Promise.all(tables.map((table) => sqlRows(req.dbHost, app, warehouseId, I.tableProbeStatement(table))
        .then(() => null)
        .catch((err) => {
          const reason = I.tableAccessReason(table, err && err.message);
          return reason ? { table, reason, error: String(err.message || '').slice(0, 300) } : null;
        }))),
      Promise.all(tables.map((t) => abacRead(req, app, t))),
    ]);
    const lost = probes.filter(Boolean);
    const policyLost = tables.filter((_t, i) => reads[i].unreadable);
    const policied = tables.filter((_t, i) => reads[i].policied);
    if (!lost.length && !policyLost.length) return { missing: [], policied, app_unreadable: null };
    const who = await appIdentity(req, app);
    const grantable = [...new Set([...lost.map((m) => m.table), ...policyLost])];
    const builtIn = grantable.filter((t) => I.builtInSampleTable(t));
    const shareable = grantable.filter((t) => !builtIn.includes(t));
    if (!shareable.length) {
      return { missing: lost, policied, app_unreadable: { tables: builtIn, app: { name: who.name, id: who.id }, grants: [], can_grant: false,
        builtin: builtIn, text: I.builtInSampleMessage(builtIn) } };
    }
    const rows = await Promise.all(shareable.map((t) => accessRowsOf(req, app, warehouseId, t)));
    // The live policy refusal is the truth for READ METADATA: it is asked for even where the grant rows say it is held.
    const offer = I.appReadGrantsOffer(shareable, shareable.map((t, i) => I.accessPlan(t, rows[i], who.id, { needs: I.IMPLEMENT_SOURCE_NEEDS,
      refused: policyLost.includes(t) ? I.IMPLEMENT_ABAC_READ_NEEDS.map(([privilege]) => privilege) : [] })), who);
    const message = I.appUnreadableMessage(offer, job);
    // REQ-131, REQ-260: the exact GRANT statements travel as the Permission Required entry the App raises; the prose names the dialog
    const permissions = offer.grants.length ? [permissionRequired({ statements: offer.grants, principal: who.id, wholeCatalogs: scope.wholeCatalogs || [],
      why: "Inspire reads these source tables with the App's service principal, the same for every person." })] : [];
    const opener = policyLost.length ? `${I.abacUnreadableSentence(who.name || who.id, { app: true })}. ${message.charAt(0).toUpperCase()}${message.slice(1)}` : message;
    const text = opener + (builtIn.length ? `. ${I.builtInSampleMessage(builtIn)}` : '');
    return { missing: lost, policied, app_unreadable: { ...offer, permissions, builtin: builtIn, text } };
  }

  async function runPersonGrants(req, token, warehouseId, statements) {
    const ran = [];
    const failed = [];
    for (const sql of statements) {
      try {
        await executeSql(req.dbHost, token, warehouseId, sql);
        ran.push(sql);
      } catch (err) {
        failed.push(`${sql}: ${String((err && err.message) || err).slice(0, 200)}`);
      }
    }
    return { ran, failed };
  }

  async function abacGrantsOf(req, token, warehouseId, tables) {
    const who = await appIdentity(req, await appTokenOf(req));
    const shareable = tables.filter((t) => !I.builtInSampleTable(t));
    if (!shareable.length || !who.id) return { grants: [], gaps: [] };
    const rows = await Promise.all(shareable.map((t) => accessRowsOf(req, token, warehouseId, t)));
    const needs = [...I.IMPLEMENT_READ_NEEDS, ...I.IMPLEMENT_ABAC_READ_NEEDS];
    const plans = shareable.map((t, i) => I.accessPlan(t, rows[i], who.id, { needs }));
    return {
      grants: [...new Set(plans.flatMap((p) => p.grants.map((g) => I.grantSql(g, who.id))))],
      gaps: shareable.flatMap((table, i) => (plans[i].gaps.length
        ? [{ table, owner: plans[i].gaps[0].owner || '', grants: plans[i].gaps.map((g) => I.grantSql(g, who.id)) }] : [])),
    };
  }

  async function grantSourceAccess(req, token, warehouseId, tables, job = 'build', scope = {}) {
    const before = await sourceAccess(req, warehouseId, tables, job, scope);
    const offer = before.app_unreadable;
    const abac = await abacGrantsOf(req, token, warehouseId, tables);
    const readGrants = offer && offer.can_grant ? offer.grants : [];
    const statements = [...new Set([...readGrants, ...abac.grants])];
    if (!statements.length) {
      if (offer && !offer.can_grant) {
        const err = I.badRequest(offer.text, 403);
        err.details = { app_unreadable: offer };
        throw err;
      }
      return { granted: 0, ran: [], failed: [], missing_tables: before.missing, app_unreadable: offer || null, abac_gaps: abac.gaps };
    }
    const { ran, failed } = await runPersonGrants(req, token, warehouseId, statements);
    const after = await sourceAccess(req, warehouseId, tables, job, scope);
    const left = await abacGrantsOf(req, token, warehouseId, tables);
    return { granted: ran.length, ran, failed, missing_tables: after.missing, app_unreadable: after.app_unreadable, abac_gaps: left.gaps };
  }

  // Who may open a user-authorization App right now, read from its sharing so a viewer shared later is included.
  async function audienceOf(req, token, appName) {
    const resp = await dbFetch(req.dbHost, token, `/api/2.0/permissions/apps/${encodeURIComponent(appName)}`);
    if (!resp.ok) throw I.badRequest(`Inspire could not read who may open the App ${appName} (HTTP ${resp.status}), so it cannot check its data.`, 502);
    return I.appAudience(parseExactJson((await resp.text()) || '{}')).map((p) => p.name);
  }

  // The one derivation the card, Check again and Grant share for the service principal: the live plan of each table for the
  // principal read from its token (IMPLEMENT_SOURCE_NEEDS, READ METADATA included), with the rows the card reads.
  // REQ-301: the identity id (SCIM) of each person who may open the App. Unity Catalog reports an owner by that id, so a person who owns
  // an object is recognised as its owner by id as well as by email. A lookup that fails leaves the email as the only identity.
  async function identityIdsOf(req, token, principals) {
    const ids = {};
    await Promise.all(principals.filter((p) => p.includes('@')).map(async (p) => {
      try {
        const resp = await dbFetch(req.dbHost, token, `/api/2.0/preview/scim/v2/Users?filter=${encodeURIComponent(`userName eq "${p}"`)}&count=1`);
        if (!resp.ok) return;
        const id = String(((parseExactJson((await resp.text()) || '{}').Resources || [])[0] || {}).id || '').trim();
        if (id) ids[p] = [id];
      } catch {
        // the id is unknown: the owner check keeps the email
      }
    }));
    return ids;
  }

  async function appReadsLeftOf(req, token, warehouseId, record, principals, who) {
    if (record.objects) {
      // The App's own objects (its Data Filters views and reasons view): a user-authorization App reads them as each person who
      // may open it, a service-principal App as its live service principal. Both are the same derivation.
      const rows = await Promise.all(record.tables.map((t) => accessRowsOf(req, token, warehouseId, t.table)));
      const aliases = record.mode === 'user' ? await identityIdsOf(req, token, principals) : {};
      return I.appReadsLeftFor(record, principals, rows, aliases);
    }
    const rows = await Promise.all(record.tables.map((t) => accessRowsOf(req, token, warehouseId, t.table)));
    const tables = record.tables.map((t) => t.table);
    return I.appReadsLeft(record, tables, tables.map((t, i) => I.accessPlan(t, rows[i], who.id, { needs: I.IMPLEMENT_SOURCE_NEEDS })), who.id);
  }

  // The service principal of the App Inspire built, read from the platform's App record with the person's own token. It is
  // never the Inspire host's identity: grants on a built App's data go to the App that reads them.
  async function builtAppIdentity(req, token, appName) {
    const resp = await dbFetch(req.dbHost, token, `/api/2.0/apps/${encodeURIComponent(appName)}`);
    if (!resp.ok) throw I.badRequest(`Inspire could not read the App ${appName} (HTTP ${resp.status}), so it cannot tell which service principal reads its data.`, 502);
    const app = parseExactJson((await resp.text()) || '{}');
    const id = String(app.service_principal_client_id || '').trim();
    if (!id) throw I.badRequest(`The App ${appName} has no service principal yet, so Inspire grants it nothing.`, 409);
    return { id, name: String(app.service_principal_name || '') };
  }

  // REQ-418: a built App on the service principal is read and granted for as that principal; a per-user App is read as each person, and a
  // grant is always run with the signed-in person's own sign-in (the person who holds the right to grant it).
  async function appReads(req, warehouseId, record, grant) {
    const person = P.forwardedTokenOf(req);
    const user = record.mode === 'user';
    const reader = user ? person : await appTokenOf(req);
    if (!reader) throw I.badRequest(user ? I.IMPLEMENT_GRANT_NO_SIGN_IN : I.IMPLEMENT_APP_TOKEN_MISSING, 401);
    const who = user ? null : await builtAppIdentity(req, reader, record.app_name);
    const principals = user ? await audienceOf(req, reader, record.app_name) : [who.id];
    // A user-authorization App's audience is granted its App-owned views only, never a source table it reads directly.
    const grantable = (left) => (record.objects ? I.appReadsGrantableFor(left, principals, user ? record.views : null) : I.appReadsGrantable(left, who && who.id));
    const before = await appReadsLeftOf(req, reader, warehouseId, record, principals, who);
    if (!grant) return { left: before, ran: [], failed: [], principals, app: who };
    if (!person) throw I.badRequest(I.IMPLEMENT_GRANT_NO_SIGN_IN, 401);
    const statements = grantable(before);
    const { ran, failed } = await runPersonGrants(req, person, warehouseId, statements);
    return { left: ran.length ? await appReadsLeftOf(req, reader, warehouseId, record, principals, who) : before, ran, failed, principals, app: who };
  }

  return { accessRowsOf, appIdentity, appReads, appTokenOf, grantSourceAccess, runPersonGrants, sourceAccess };
}

module.exports = { createSourceAccess };
