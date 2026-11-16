import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { PlainMessage } from './TechnicalDetails';
import { groupLabelOf } from '../lib/implementWizard';
import { raisePermissions } from '../lib/permissionBus';
import { METRIC_VIEW_REFUSAL } from '../lib/pickProblem';
import { leftOutLine } from '../lib/tableUsability';
import {
  SCOPE_OPS, columnKindOf, filterValuesOf, isGroupRow, labelAvailable, normalizeTableScope, scopeKeyOf, scopeOpOf, scopeProblems, tableScopeOf,
} from '../lib/tableScope';

const VALUE_CHIPS = 40;
const COUNT_DEBOUNCE_MS = 350;
const GROUP_TOP = 500;
const ANSWER_MS = 20000;
const HITS_SHOWN = 60;
const BUTTON = 'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap px-3 rounded-lg text-xs font-semibold border border-border bg-surface text-text-primary hover:bg-bg-subtle disabled:opacity-50';
const FIELD = 'h-8 rounded-md border border-border bg-surface px-2 text-xs text-text-primary';
const CHIP = 'inline-flex items-center gap-1 rounded-full bg-db-red-50 px-2 py-0.5 text-db-red-fg';

const maxValues = (op) => {
  const def = scopeOpOf(op);
  if (!def) return 0;
  return def.values === 'many' ? Infinity : def.values;
};

function filterIsComplete(f) {
  const def = scopeOpOf(f.op);
  if (!def || !f.column) return false;
  if (def.values === 'many') return f.values.length > 0;
  return f.values.length === def.values;
}

const shortName = (table) => table.split('.').pop();
const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Inspire did not get an answer in time.')), ms);
  promise.then((value) => { clearTimeout(timer); resolve(value); }, (err) => { clearTimeout(timer); reject(err); });
});
const browseQuery = (warehouseId, table) => `warehouse_id=${encodeURIComponent(warehouseId || '')}&table=${encodeURIComponent(table)}`;
const valueKey = (warehouseId, table, column) => `val:${warehouseId || ''}:${table}\u0000${column}`;
const groupKey = (table, column) => `${table}\u0000${column}`;
const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

function conditionText(f) {
  const def = scopeOpOf(f.op);
  const label = def ? def.label : f.op;
  if (!def || def.values === 0) return label;
  return `${label} ${f.values.join(def.op === 'in' ? ', ' : ' and ')}`;
}

// One row of a table's filter: a condition on a column, or a row group (the values the person picked for a column).
const rowText = (f) => (isGroupRow(f) ? `groups: ${f.values.join(', ')}` : conditionText(f));

// Columns whose name contains the search text, case-insensitive, grouped by the exact column name. A group lists the tables that have it.
function hitsOf(query, tables, columnsOf) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const groups = new Map();
  for (const table of tables) {
    const meta = columnsOf[table];
    if (!meta || meta.error || !Array.isArray(meta.columns)) continue;
    for (const c of meta.columns) {
      const name = String(c.column_name);
      if (!name.toLowerCase().includes(q)) continue;
      const key = name.toLowerCase();
      if (!groups.has(key)) groups.set(key, { name, hits: [] });
      groups.get(key).hits.push({ table, type: c.data_type || '' });
    }
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function AddRowFilter({ table, column, who, openLabel = 'Add row filter', commitLabel = 'Add filter', suggestions, loadValues, onCommit }) {
  const [open, setOpen] = useState(false);
  const [op, setOp] = useState('=');
  const [draft, setDraft] = useState([]);
  const [typed, setTyped] = useState('');
  const def = scopeOpOf(op);
  const max = maxValues(op);
  const needsValues = def.values !== 0;
  const complete = def.values === 'many' ? draft.length > 0 : draft.length === def.values;
  useEffect(() => { if (open) loadValues(table, column); }, [open, table, column, loadValues]);
  const reset = () => { setOpen(false); setOp('='); setDraft([]); setTyped(''); };
  const addValue = (value) => {
    const text = String(value ?? '').trim();
    if (!text || draft.includes(text)) return;
    setDraft(max === 1 ? [text] : [...draft, text].slice(0, max));
  };
  if (!open) {
    return <button type="button" aria-label={`${openLabel} on ${who || column}`} className={`${BUTTON} whitespace-nowrap`} onClick={() => setOpen(true)}>{openLabel}</button>;
  }
  return (
    <fieldset aria-label={`New row filter on ${who || column}`} className="w-full rounded-lg border border-border bg-surface p-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label={`Operator for ${who || column}`} className={FIELD} value={op} onChange={(e) => { setOp(e.target.value); setDraft([]); }}>
          {SCOPE_OPS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
        </select>
        {needsValues && draft.length < max && (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addValue(typed); setTyped(''); }}>
            <input dir="auto" aria-label={`Value for ${who || column}`} className={FIELD} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type a value" />
            <button type="submit" className={BUTTON} disabled={!typed.trim()}>Add value</button>
          </form>
        )}
      </div>
      {needsValues && draft.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {draft.map((v, i) => (
            <span key={`${i}-${v}`} className={CHIP}>
              {v}
              <button type="button" aria-label={`Remove value ${v}`} onClick={() => setDraft(draft.filter((x) => x !== v))}><X size={10} /></button>
            </span>
          ))}
        </div>
      )}
      {needsValues && suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1" aria-label={`Values in ${who || column}`}>
          {suggestions.map((v, i) => (
            <button key={`${i}-${v}`} type="button" data-scope-value={v} onClick={() => addValue(v)}
              className="rounded-md border border-border bg-bg-subtle px-2 py-0.5 text-text-secondary hover:text-text-primary">
              {v}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <button type="button" className={BUTTON} disabled={!complete}
          onClick={() => { onCommit({ column, op, values: draft }); reset(); }}>{commitLabel}</button>
        <button type="button" className={BUTTON} onClick={reset}>Cancel</button>
      </div>
    </fieldset>
  );
}

function RowGroups({ column, picked, loaded, onLoad, onPick }) {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(true);
  const values = loaded?.status === 'done' ? loaded.values : [];
  const shown = values.filter((g) => !search || g.value.toLowerCase().includes(search.trim().toLowerCase()));
  const chosen = new Set(picked);
  const listing = loaded?.status === 'done' && values.length > 0 && (editing || picked.length === 0);
  return (
    <div className="space-y-2" data-row-groups={column}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BUTTON} aria-label={`Load groups for ${column}`} disabled={loaded?.status === 'loading'}
          onClick={() => { setEditing(true); onLoad(); }}>
          {loaded ? 'Reload groups' : 'Load groups'}
        </button>
        {loaded?.status === 'loading' && <span className="text-text-tertiary">Loading the groups of {column}</span>}
        {loaded?.status === 'done' && (
          <span className="text-text-tertiary">
            {plural(values.length, 'value')}{loaded.truncated ? `, the top ${GROUP_TOP} by rows` : ''}
          </span>
        )}
        {loaded?.status === 'done' && values.length > 0 && picked.length > 0 && (
          <button type="button" className={BUTTON} onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Change groups'}</button>
        )}
      </div>
      {loaded?.status === 'error' && <PlainMessage role="alert" className="text-error-fg" text={loaded.error} />}
      {listing && (
        <>
          {values.length > 20 && (
            <input type="search" aria-label={`Search the groups of ${column}`} value={search} placeholder="Search groups" dir="auto"
              onChange={(e) => setSearch(e.target.value)} className={`${FIELD} w-full`} />
          )}
          <div className="flex gap-2">
            <button type="button" className={BUTTON} onClick={() => onPick(values.map((g) => g.value))}>Select all</button>
            <button type="button" className={BUTTON} onClick={() => onPick([])}>Clear</button>
          </div>
          <ul aria-label={`Groups of ${column}`} className="grid gap-1 max-h-56 overflow-y-auto">
            {shown.map((g) => (
              <li key={g.value}>
                <label className="flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1">
                  <input type="checkbox" data-group-value={g.value} checked={chosen.has(g.value)}
                    onChange={() => onPick(chosen.has(g.value) ? picked.filter((v) => v !== g.value) : [...picked, g.value])} />
                  <span dir="auto" className="text-text-primary">{g.value}</span>
                  <span className="ms-auto text-text-tertiary">{g.records.toLocaleString()}</span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      {loaded?.status === 'done' && values.length === 0 && <p className="text-text-secondary">{column} has no values in the rows in scope.</p>}
      {picked.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {picked.map((v, i) => (
            <span key={`${i}-${v}`} data-scope-group={column} className={CHIP}>
              <span dir="auto">{v}</span>
              <button type="button" aria-label={`Remove group ${v}`} onClick={() => onPick(picked.filter((x) => x !== v))}><X size={10} /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function UseCaseLabel({ scopes, tables, label, onLabel }) {
  const available = labelAvailable(scopes, tables);
  const prefill = groupLabelOf(filterValuesOf(scopes, tables));
  const shown = label.text == null ? prefill : label.text;
  return (
    <div data-use-case-label className="rounded-xl border border-border p-3 space-y-2">
      <label className="flex items-center gap-2 font-semibold text-text-primary">
        <input type="checkbox" data-use-case-label-on checked={label.on && available} disabled={!available}
          onChange={(e) => onLabel({ ...label, on: e.target.checked })} />
        Use case labeling enhanced using filters
      </label>
      <input dir="auto" type="text" aria-label="Use case label" data-use-case-label-text value={shown} disabled={!label.on || !available}
        placeholder={!available ? 'Add a row group to fill in the label' : label.on ? 'Pick row groups, then the label fills in here' : 'Tick the box above to use a label'}
        onChange={(e) => onLabel({ ...label, text: e.target.value })}
        className={`${FIELD} h-9 w-full disabled:opacity-50`} />
      {label.text != null && label.on && available && (
        <button type="button" className={BUTTON} onClick={() => onLabel({ ...label, text: null })}>Use the group values</button>
      )}
      {!available && <p data-use-case-label-reason className="text-text-secondary">Add a row group above to label your use cases.</p>}
      <p className="text-text-tertiary">
        Inspire puts this label in the name of every use case that reads a filtered table, for example
        &quot;Improve Contoso customer experience using segmentation&quot;.
      </p>
    </div>
  );
}

// One table that has the searched column: its type, the filter on it (if any), and its row groups (categorical columns only).
function HitRow({ hit, name, rows, read, onRead, valuesOf, loadValues, groupOf, groupState, onLoadGroups, onPickGroups, onAdd }) {
  const [groupsOpen, setGroupsOpen] = useState(false);
  const conditions = rows.map((f, index) => ({ f, index })).filter(({ f }) => f.column === name);
  const categorical = columnKindOf(hit.type) === 'categorical';
  return (
    <li data-scope-row={hit.table} className="flex flex-wrap items-start gap-2 border-t border-border pt-2">
      <span className="font-mono text-text-primary" title={hit.table}>{shortName(hit.table)}</span>
      <span className="text-text-tertiary">{hit.type}</span>
      <label className="flex items-center gap-1.5 text-text-secondary">
        <input type="checkbox" aria-label={`Read ${name} in ${shortName(hit.table)}`} checked={read} onChange={(e) => onRead(e.target.checked)} />
        Read
      </label>
      <div className="flex flex-wrap gap-1.5 min-w-0">
        {conditions.map(({ f }, i) => <span key={i} data-scope-filtered={name} className="text-text-secondary">{conditionText(f)}</span>)}
      </div>
      <div className="ms-auto flex flex-wrap gap-2">
        <AddRowFilter table={hit.table} column={name} who={`${name} in ${shortName(hit.table)}`} suggestions={valuesOf(hit.table, name)}
          loadValues={loadValues} onCommit={(condition) => onAdd(hit.table, condition)} />
        {categorical && (
          <button type="button" className={BUTTON} aria-expanded={groupsOpen} onClick={() => setGroupsOpen(!groupsOpen)}>Row groups</button>
        )}
      </div>
      {categorical && groupsOpen && (
        <div className="w-full">
          <RowGroups column={name} picked={groupOf(hit.table, name)} loaded={groupState(hit.table, name)}
            onLoad={() => onLoadGroups(hit.table, name)} onPick={(values) => onPickGroups(hit.table, name, values)} />
        </div>
      )}
      {!categorical && <p className="w-full text-text-tertiary">Row groups are for text columns. Use a row filter for numbers and dates.</p>}
    </li>
  );
}

export default function DataFilters({ scope, scopes, tables, listing, onScopes, label, onLabel, apiFetch, warehouseId, onProblems }) {
  const [query, setQuery] = useState('');
  const [columnsOf, setColumnsOf] = useState({});
  const [valuesOf, setValuesOf] = useState({});
  const [counts, setCounts] = useState({});
  const [groupsOf, setGroupsOf] = useState({});
  const [note, setNote] = useState('');
  const requested = useRef(new Set());
  const fired = useRef({});
  const tablesJson = JSON.stringify(tables);
  // The effect reads the current list through a ref; tablesJson only tells it when the list changed.
  const tablesNow = useRef(tables);
  tablesNow.current = tables;
  const rowsOf = (table) => normalizeTableScope(tableScopeOf(scopes, table)).rows;
  const namesOf = (table) => (columnsOf[table]?.columns || []).map((c) => c.column_name);
  const jobs = tables
    .map((table) => ({ table, filters: rowsOf(table).filter(filterIsComplete) }))
    .filter((job) => job.filters.length)
    .map((job) => ({ ...job, key: `${warehouseId || ''}|${JSON.stringify(job.filters)}` }));
  const jobsJson = JSON.stringify(jobs);

  useEffect(() => {
    tablesNow.current.forEach((table) => {
      const key = `cols:${warehouseId || ''}:${table}`;
      if (requested.current.has(key)) return;
      requested.current.add(key);
      apiFetch(`/api/inspire/implement/columns?${browseQuery(warehouseId, table)}`)
        .then((d) => setColumnsOf((prev) => ({ ...prev, [table]: { columns: d.columns || [], keys: d.primary_keys || [] } })))
        .catch((e) => setColumnsOf((prev) => ({ ...prev, [table]: {
          error: e.message || 'The columns of this table could not be read.',
          // A saved pick that is a metric view: the refusal line, acted on by the effect below.
          refused: METRIC_VIEW_REFUSAL.test(e.message || '') ? e.message : '',
          permissions: Array.isArray(e.body?.permissions) ? e.body.permissions : [],
        } })));
    });
  }, [tablesJson, apiFetch, warehouseId]);

  const latestJobs = useRef(jobs);
  useEffect(() => { latestJobs.current = jobs; });
  useEffect(() => {
    const timer = setTimeout(() => {
      latestJobs.current.forEach(({ table, key, filters }) => {
        if (fired.current[table] === key) return;
        fired.current[table] = key;
        withTimeout(apiFetch(`/api/inspire/implement/readiness?${browseQuery(warehouseId, table)}`, {
          method: 'POST',
          body: JSON.stringify({ table, columns: [], filters, window: {} }),
        }), ANSWER_MS)
          .then((d) => setCounts((prev) => ({ ...prev, [table]: { key, rows: Number(d.row_count) || 0 } })))
          .catch((e) => setCounts((prev) => ({ ...prev, [table]: { key, error: e.message || 'The rows could not be counted.' } })));
      });
    }, COUNT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [jobsJson, apiFetch, warehouseId]);

  const loadValues = (table, column) => {
    const key = valueKey(warehouseId, table, column);
    if (!column || requested.current.has(key)) return;
    requested.current.add(key);
    apiFetch(`/api/inspire/implement/values?${browseQuery(warehouseId, table)}&column=${encodeURIComponent(column)}&limit=${VALUE_CHIPS}`)
      .then((d) => setValuesOf((prev) => ({ ...prev, [key]: d.values || [] })))
      .catch(() => setValuesOf((prev) => ({ ...prev, [key]: [] })));
  };
  const valuesFor = (table, column) => valuesOf[valueKey(warehouseId, table, column)] || [];

  const loadGroups = (table, name) => {
    const key = groupKey(table, name);
    setGroupsOf((prev) => ({ ...prev, [key]: { status: 'loading' } }));
    const filters = rowsOf(table).filter((f) => filterIsComplete(f) && !(isGroupRow(f) && f.column === name));
    withTimeout(apiFetch(`/api/inspire/implement/group-counts?${browseQuery(warehouseId, table)}`, {
      method: 'POST',
      body: JSON.stringify({ columns: [name], filters, window: {}, top: GROUP_TOP }),
    }), ANSWER_MS)
      .then((d) => setGroupsOf((prev) => ({
        ...prev,
        [key]: {
          status: 'done',
          truncated: Boolean(d.truncated),
          values: (d.groups || []).map((g) => ({ value: String(g[name]), records: Number(g.records) || 0 })),
        },
      })))
      .catch((e) => {
        const permissions = Array.isArray(e.body?.permissions) ? e.body.permissions : [];
        setGroupsOf((prev) => ({ ...prev, [key]: { status: 'error', error: e.message || `The groups of ${name} could not be listed.`, permissions } }));
        raisePermissions(permissions, { retry: () => loadGroups(table, name) });
      });
  };

  const problemsOf = (table) => {
    const entry = tableScopeOf(scopes, table);
    if (!entry) return [];
    const short = shortName(table);
    const meta = columnsOf[table];
    const list = scopeProblems(entry, meta?.columns ? meta.columns.map((c) => c.column_name) : null).map((p) => `${short}: ${p}`);
    const job = jobs.find((j) => j.table === table);
    const count = counts[table];
    if (job && count && count.key === job.key && count.rows === 0) {
      list.push(`${short}: its row filters keep 0 rows, so Inspire will not run them. Change a filter.`);
    }
    return list;
  };
  const problems = tables.map(problemsOf).flat();
  const labelProblem = label.on && labelAvailable(scopes, tables) && !(label.text ?? groupLabelOf(filterValuesOf(scopes, tables))).trim()
    ? ['Use case labeling is ticked but the label is empty: type the label or untick the box.'] : [];
  const allProblems = [...problems, ...labelProblem];
  const allKey = allProblems.join('\n');
  useEffect(() => { if (onProblems) onProblems(allProblems); }, [allKey, onProblems]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every change to one or more tables' filters is one write: the scopes are read once, so a group apply lands on every table.
  const commitRows = (updates) => {
    const changed = (name) => updates.some((u) => scopeKeyOf(u.table) === scopeKeyOf(name));
    const next = Object.fromEntries(Object.entries(scopes || {}).filter(([name]) => !changed(name)));
    for (const { table, rows, columns: wanted } of updates) {
      const entry = tableScopeOf(scopes, table);
      const names = namesOf(table);
      const columns = wanted || (entry ? normalizeTableScope(entry).columns : names);
      // With no rows left and every column read, the table goes back to a plain read.
      const whole = names.length ? names.every((n) => columns.includes(n)) : !entry;
      if (!rows.length && whole) continue;
      next[table] = { columns: names.length ? names.filter((n) => columns.includes(n)) : columns, rows };
    }
    onScopes(next);
  };
  // Read for one column of one table: the table's columns with the column added or left out, and the row filters on a column
  // that is no longer read are dropped (a column Inspire does not read cannot be filtered), with the note saying which.
  const readUpdate = (table, name, read) => {
    const entry = tableScopeOf(scopes, table);
    const current = entry ? normalizeTableScope(entry).columns : namesOf(table);
    const columns = read ? [...new Set([...current, name])] : current.filter((c) => c !== name);
    const kept = rowsOf(table).filter((f) => columns.includes(f.column));
    const dropped = rowsOf(table).filter((f) => !columns.includes(f.column)).map((f) => f.column);
    return { table, columns, rows: kept, dropped };
  };
  const applyRead = (updates) => {
    commitRows(updates.map(({ table, columns, rows }) => ({ table, columns, rows })));
    const dropped = updates.filter((u) => u.dropped.length);
    setNote(dropped.map((u) => `Removed ${u.dropped.length} row filter${u.dropped.length === 1 ? '' : 's'} on ${[...new Set(u.dropped)].join(', ')} in ${shortName(u.table)}: a column Inspire does not read cannot be filtered.`).join(' '));
  };
  const readsColumn = (table, name) => {
    const entry = tableScopeOf(scopes, table);
    return !entry || normalizeTableScope(entry).columns.includes(name);
  };
  const addRow = (table, condition) => commitRows([{ table, rows: [...rowsOf(table), condition] }]);
  const removeRow = (table, index) => commitRows([{ table, rows: rowsOf(table).filter((_, i) => i !== index) }]);
  const pickGroups = (table, name, values) => {
    const rows = rowsOf(table);
    const others = rows.filter((f) => !(isGroupRow(f) && f.column === name));
    commitRows([{ table, rows: values.length ? [...others, { column: name, op: 'in', values, group: true }] : others }]);
  };
  const groupOf = (table, name) => rowsOf(table).find((f) => isGroupRow(f) && f.column === name)?.values || [];
  const groupState = (table, name) => groupsOf[groupKey(table, name)];

  // A saved pick that is a metric view is dropped from the scope on load, with a note. Idempotent: it acts only while the entry is still in the scope.
  useEffect(() => {
    for (const [table, info] of Object.entries(columnsOf)) {
      if (!info.refused || !tableScopeOf(scopes, table)) continue;
      onScopes(Object.fromEntries(Object.entries(scopes || {}).filter(([name]) => scopeKeyOf(name) !== scopeKeyOf(table))));
    }
  }, [columnsOf, scopes, onScopes]);

  const hits = hitsOf(query, tables, columnsOf);
  const hitTables = hits.reduce((n, g) => n + g.hits.length, 0);
  const loading = tables.filter((t) => !columnsOf[t]).length;
  // Every picked table that has a saved scope is listed, so a problem with it is shown where the person can fix it.
  const withFilters = tables.filter((t) => tableScopeOf(scopes, t));
  // The columns of a saved table that Inspire does not read, named as table.column (the person can see them without a search).
  const leftOutColumns = withFilters.flatMap((table) => {
    const kept = normalizeTableScope(tableScopeOf(scopes, table)).columns;
    return namesOf(table).filter((n) => !kept.includes(n)).map((n) => `${shortName(table)}.${n}`);
  });
  const nothingPicked = !scope.entries.length;
  const countLine = (table) => {
    const job = jobs.find((j) => j.table === table);
    if (!job) return '';
    const c = counts[table];
    return !c || c.key !== job.key ? 'counting rows' : c.error ? 'rows could not be counted' : `${c.rows.toLocaleString()} rows match`;
  };

  return (
    <div data-data-filters className="space-y-4 text-xs">
      {[...new Set(Object.values(columnsOf).map((info) => info.refused).filter(Boolean))].map((note) => (
        <p key={note} role="status" data-metric-view-note="" className="text-warning-fg">
          {note} Its scope was dropped from Data Management; the table is left out of the run.
        </p>
      ))}
      <p className="text-text-secondary">
        A table with no filter is read whole: every column, every row. Search a column name to add a filter to it.
        Use Apply to all to filter a column that several tables have, in one step.
      </p>
      {nothingPicked && <p data-data-filters-empty className="text-text-tertiary">Pick tables, schemas or catalogs under Unity Catalog Metadata to filter them.</p>}
      {!nothingPicked && (
        <>
          {withFilters.length > 0 && (
            <div data-filters-in-use className="rounded-lg border border-border p-3 space-y-2">
              <p className="font-semibold text-text-primary">Filters in use</p>
              {withFilters.map((table) => (
                <div key={table} data-filter-table={table} className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-text-primary" title={table}>{shortName(table)}</span>
                    {countLine(table) && <span className="text-text-secondary">{countLine(table)}</span>}
                    {problemsOf(table).length > 0 && <span className="text-db-red-fg">needs a fix</span>}
                  </div>
                  {problemsOf(table).length > 0 && (
                    <ul role="alert" className="list-disc ps-4 text-error-fg">{problemsOf(table).map((p) => <li key={p}>{p}</li>)}</ul>
                  )}
                  <ul className="flex flex-wrap gap-1.5">
                    {rowsOf(table).map((f, index) => (
                      <li key={index} data-scope-condition={f.column} className={CHIP}>
                        <span>{f.column}: {rowText(f)}</span>
                        <button type="button" aria-label={`Remove ${f.group ? 'row group' : 'row filter'} on ${f.column} in ${shortName(table)}: ${rowText(f)}`}
                          onClick={() => removeRow(table, index)}>
                          <X size={10} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {leftOutColumns.length > 0 && (
                <div data-columns-left-out className="space-y-1 border-t border-border pt-2 text-text-secondary">
                  <p>Columns left out: {leftOutColumns.length}</p>
                  <ul className="flex flex-wrap gap-1.5">
                    {leftOutColumns.map((full) => <li key={full} data-left-out-column={full} className="font-mono text-text-tertiary">{full}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
          {note && <p data-scope-note="dropped" role="status" className="text-text-secondary">{note}</p>}
          <div data-column-search className="space-y-3">
            <input type="search" aria-label="Search column names" value={query} dir="auto" onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a column name, for example brand" className={`${FIELD} h-9 w-full`} />
            {loading > 0 && <p className="text-text-tertiary">Reading the columns of {plural(loading, 'table')}</p>}
            {tables.length === 0 && (
              <p data-search-empty className="text-text-secondary">
                None of the tables you picked can be searched yet. Check them in the table picker above, then Try again.
              </p>
            )}
            {!query.trim() && tables.length > 0 && (
              <p data-search-hint className="text-text-secondary">Type a column name to find it in the {plural(tables.length, 'table')} you picked.</p>
            )}
            {query.trim() && loading === 0 && hits.length === 0 && (
              <p data-search-none className="text-text-secondary">No column name contains &quot;{query.trim()}&quot; in the {plural(tables.length, 'table')} you picked.</p>
            )}
            {hits.length > 0 && (
              <p className="text-text-secondary">{plural(hits.length, 'column name')} match, in {plural(hitTables, 'table')}.</p>
            )}
            {listing.listErrors.map((message) => <PlainMessage key={message} role="alert" className="text-error-fg" text={message} />)}
            {listing.leftOut.map((l) => <p key={`${l.schema}-${l.count}`} data-left-out="" className="text-text-secondary">{leftOutLine(l)}</p>)}
            {hits.slice(0, HITS_SHOWN).map((group) => (
              <section key={group.name.toLowerCase()} data-column-group={group.name} className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold text-text-primary">{group.name}</span>
                  <span className="text-text-tertiary">in {plural(group.hits.length, 'table')}</span>
                  {group.hits.length > 1 && (
                    <label className="ms-auto flex items-center gap-1.5 text-text-secondary">
                      <input type="checkbox" aria-label={`Read ${group.name} in all ${group.hits.length} tables`}
                        checked={group.hits.every((h) => readsColumn(h.table, group.name))}
                        onChange={(e) => applyRead(group.hits.map((h) => readUpdate(h.table, group.name, e.target.checked)))} />
                      Read in all {group.hits.length} tables
                    </label>
                  )}
                  {group.hits.length > 1 && (
                    <div>
                      <AddRowFilter table={group.hits[0].table} column={group.name} who={`${group.name} in ${group.hits.length} tables`}
                        openLabel="Apply to all" commitLabel="Apply to all tables" suggestions={valuesFor(group.hits[0].table, group.name)} loadValues={loadValues}
                        onCommit={(condition) => commitRows(group.hits.map((h) => ({ table: h.table, rows: [...rowsOf(h.table), condition] })))} />
                    </div>
                  )}
                </div>
                <ul className="space-y-1">
                  {group.hits.map((hit) => (
                    <HitRow key={hit.table} hit={hit} name={group.name} rows={rowsOf(hit.table)} read={readsColumn(hit.table, group.name)}
                      onRead={(next) => applyRead([readUpdate(hit.table, group.name, next)])} valuesOf={valuesFor} loadValues={loadValues}
                      groupOf={groupOf} groupState={groupState} onLoadGroups={loadGroups} onPickGroups={pickGroups}
                      onAdd={addRow} />
                  ))}
                </ul>
              </section>
            ))}
            {hits.length > HITS_SHOWN && (
              <p data-hits-more className="text-text-secondary">Showing {HITS_SHOWN} of {plural(hits.length, 'column name')}. Type more letters to narrow it down.</p>
            )}
          </div>
        </>
      )}
      {tables.length > 0 && <UseCaseLabel scopes={scopes} tables={tables} label={label} onLabel={onLabel} />}
    </div>
  );
}
