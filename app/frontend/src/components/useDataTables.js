import { useCallback, useEffect, useRef, useState } from 'react';
import { pickedTableNames, scopeKeyOf, tableBrowseQuery } from '../lib/tableScope';
import { typeCheckBusyOf, unusableReasonOf } from '../lib/tableUsability';
import { createLimiter, queuedListing } from '../lib/listQueue';
import { isInspireOwnName } from '../lib/inspireOwnObjects';

// Listing requests in flight at once (REQ-378): a whole-catalog pick lists every schema, and one request per schema at once overran the App.
const LISTINGS_AT_ONCE = 3;

// The tables Data Management works on (REQ-362, REQ-363): the tables the Launch picks, plus every table of a picked schema and of a
// catalog picked whole. Both sections read this one list, so the relationships and the column search see the same tables.
// Metric views are not tables: they cannot be filtered, so they are left out of the list and named once (REQ-370). A metric view
// is known from a schema listing, or from a read that names it (addMetricViews).
export default function useDataTables({ scope, scopes, apiFetch, warehouseId }) {
  const [listed, setListed] = useState({});
  const [catalogSchemas, setCatalogSchemas] = useState({});
  const [namedViews, setNamedViews] = useState([]);
  const requested = useRef(new Set());
  const limit = useRef(createLimiter(LISTINGS_AT_ONCE)).current;
  const [attempt, setAttempt] = useState(0);

  // The schemas whose tables are listed: each picked schema, and each schema of a catalog picked whole.
  const schemaNames = [...new Set([
    ...scope.schemas,
    ...scope.catalogs.flatMap((c) => (catalogSchemas[c]?.schemas || []).map((s) => `${c}.${s}`)),
  ])];
  const seen = new Set();
  const everyTable = [...pickedTableNames(scopes, scope), ...schemaNames.flatMap((s) => listed[s]?.tables || [])]
    .filter((t) => (seen.has(scopeKeyOf(t)) ? false : seen.add(scopeKeyOf(t))));
  const views = new Map();
  for (const name of [...Object.values(listed).flatMap((l) => l.metricViews || []), ...namedViews]) views.set(scopeKeyOf(name), name);
  const tables = everyTable.filter((t) => !views.has(scopeKeyOf(t)));
  const metricViews = [...views.values()].sort((a, b) => a.localeCompare(b));
  const addMetricViews = useCallback((names) => {
    const list = (names || []).filter(Boolean);
    if (list.length) setNamedViews((prev) => [...new Set([...prev, ...list])]);
  }, []);
  const catalogsKey = scope.catalogs.join('\n');
  const schemasKey = schemaNames.join('\n');

  useEffect(() => {
    catalogsKey.split('\n').filter(Boolean).forEach((catalog) => {
      const key = `catalog:${warehouseId || ''}:${catalog}`;
      if (requested.current.has(key)) return;
      requested.current.add(key);
      queuedListing(limit, () => apiFetch(`/api/catalogs/${encodeURIComponent(catalog)}/schemas${tableBrowseQuery(warehouseId)}`))
        .then((d) => setCatalogSchemas((prev) => ({ ...prev, [catalog]: { schemas: (d.schemas || []).map((s) => s.name) } })))
        .catch((e) => setCatalogSchemas((prev) => ({ ...prev, [catalog]: { error: e.message || `Inspire could not list the schemas of ${catalog}.` } })));
    });
  }, [catalogsKey, apiFetch, warehouseId, attempt, limit]);

  useEffect(() => {
    schemasKey.split('\n').filter(Boolean).forEach((schema) => {
      const key = `schema:${warehouseId || ''}:${schema}`;
      if (requested.current.has(key)) return;
      requested.current.add(key);
      const [catalog, name] = schema.split('.');
      queuedListing(limit, () => apiFetch(`/api/tables/${encodeURIComponent(catalog)}/${encodeURIComponent(name)}${tableBrowseQuery(warehouseId)}`))
        .then((d) => {
          // A table whose type check is busy or that is not usable is not listed here; the Launch picker says why.
          // Inspire's own tables and views are not the person's data (REQ-387): the same rule as the backend lists.
          const rows = (d.tables || []).filter((t) => !typeCheckBusyOf(t) && !unusableReasonOf(t) && !isInspireOwnName(t.full_name || `${schema}.${t.name}`));
          const metricViews = Array.isArray(d.metric_views) ? d.metric_views : [];
          setListed((prev) => ({ ...prev, [schema]: { tables: rows.map((t) => t.full_name || `${schema}.${t.name}`), metricViews, leftOut: d.left_out || null } }));
        })
        .catch((e) => setListed((prev) => ({ ...prev, [schema]: { tables: [], error: e.message || `Inspire could not list the tables of ${schema}.` } })));
    });
  }, [schemasKey, apiFetch, warehouseId, attempt, limit]);

  const leftOut = Object.values(listed).map((l) => l.leftOut).filter(Boolean);
  // One list of reasons, de-duplicated; a failed listing is named once, and Try again re-reads only the failed ones (REQ-378).
  const listErrors = [...new Set([...Object.values(listed).map((l) => l.error), ...Object.values(catalogSchemas).map((c) => c.error)].filter(Boolean))];
  const retry = () => {
    for (const [schema, l] of Object.entries(listed)) if (l.error) requested.current.delete(`schema:${warehouseId || ''}:${schema}`);
    for (const [catalog, c] of Object.entries(catalogSchemas)) if (c.error) requested.current.delete(`catalog:${warehouseId || ''}:${catalog}`);
    setListed((prev) => Object.fromEntries(Object.entries(prev).filter(([, l]) => !l.error)));
    setCatalogSchemas((prev) => Object.fromEntries(Object.entries(prev).filter(([, c]) => !c.error)));
    setAttempt((n) => n + 1);
  };
  return { tables, metricViews, addMetricViews, leftOut, listErrors, retry };
}
