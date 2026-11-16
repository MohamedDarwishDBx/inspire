import { useEffect, useRef, useState } from 'react';
import { pickedTableNames, scopeKeyOf, tableBrowseQuery } from '../lib/tableScope';
import { typeCheckBusyOf, unusableReasonOf } from '../lib/tableUsability';

// At most this many tables are read for the search and for the relationships (the same cap as the backend's relationships route).
export const DATA_TABLE_LIMIT = 40;

// The tables Data Management works on (REQ-362, REQ-363): the tables the Launch picks, plus every table of a picked schema and of a
// catalog picked whole. Both sections read this one list, so the relationships and the column search see the same tables.
export default function useDataTables({ scope, scopes, apiFetch, warehouseId }) {
  const [listed, setListed] = useState({});
  const [catalogSchemas, setCatalogSchemas] = useState({});
  const requested = useRef(new Set());

  // The schemas whose tables are listed: each picked schema, and each schema of a catalog picked whole.
  const schemaNames = [...new Set([
    ...scope.schemas,
    ...scope.catalogs.flatMap((c) => (catalogSchemas[c]?.schemas || []).map((s) => `${c}.${s}`)),
  ])];
  const seen = new Set();
  const all = [...pickedTableNames(scopes, scope), ...schemaNames.flatMap((s) => listed[s]?.tables || [])]
    .filter((t) => (seen.has(scopeKeyOf(t)) ? false : seen.add(scopeKeyOf(t))));
  const tables = all.slice(0, DATA_TABLE_LIMIT);
  const notSearched = all.length - tables.length;
  const catalogsKey = scope.catalogs.join('\n');
  const schemasKey = schemaNames.join('\n');

  useEffect(() => {
    catalogsKey.split('\n').filter(Boolean).forEach((catalog) => {
      const key = `catalog:${warehouseId || ''}:${catalog}`;
      if (requested.current.has(key)) return;
      requested.current.add(key);
      apiFetch(`/api/catalogs/${encodeURIComponent(catalog)}/schemas${tableBrowseQuery(warehouseId)}`)
        .then((d) => setCatalogSchemas((prev) => ({ ...prev, [catalog]: { schemas: (d.schemas || []).map((s) => s.name) } })))
        .catch((e) => setCatalogSchemas((prev) => ({ ...prev, [catalog]: { error: e.message || `Inspire could not list the schemas of ${catalog}.` } })));
    });
  }, [catalogsKey, apiFetch, warehouseId]);

  useEffect(() => {
    schemasKey.split('\n').filter(Boolean).forEach((schema) => {
      const key = `schema:${warehouseId || ''}:${schema}`;
      if (requested.current.has(key)) return;
      requested.current.add(key);
      const [catalog, name] = schema.split('.');
      apiFetch(`/api/tables/${encodeURIComponent(catalog)}/${encodeURIComponent(name)}${tableBrowseQuery(warehouseId)}`)
        .then((d) => {
          // A table whose type check is busy or that is not usable is not listed here; the Launch picker says why.
          const rows = (d.tables || []).filter((t) => !typeCheckBusyOf(t) && !unusableReasonOf(t));
          setListed((prev) => ({ ...prev, [schema]: { tables: rows.map((t) => t.full_name || `${schema}.${t.name}`), leftOut: d.left_out || null } }));
        })
        .catch((e) => setListed((prev) => ({ ...prev, [schema]: { tables: [], error: e.message || `Inspire could not list the tables of ${schema}.` } })));
    });
  }, [schemasKey, apiFetch, warehouseId]);

  const leftOut = Object.values(listed).map((l) => l.leftOut).filter(Boolean);
  const listErrors = [...Object.values(listed).map((l) => l.error), ...Object.values(catalogSchemas).map((c) => c.error)].filter(Boolean);
  return { tables, notSearched, leftOut, listErrors };
}
