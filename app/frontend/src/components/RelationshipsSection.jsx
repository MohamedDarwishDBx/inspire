import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { PlainMessage } from './TechnicalDetails';
import { raisePermissions } from '../lib/permissionBus';

const ANSWER_MS = 20000;
const FIELD = 'h-8 rounded-md border border-border bg-surface px-2 text-xs text-text-primary';
const BUTTON = 'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap px-3 rounded-lg text-xs font-semibold border border-border bg-surface text-text-primary hover:bg-bg-subtle disabled:opacity-50';
const MANUAL = 'added by you';

const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Inspire did not get an answer in time.')), ms);
  promise.then((value) => { clearTimeout(timer); resolve(value); }, (err) => { clearTimeout(timer); reject(err); });
});
const sameLink = (a, b) => a.from.table === b.from.table && a.from.column === b.from.column
  && a.to.table === b.to.table && a.to.column === b.to.column;
const involves = (link, table) => link.from.table === table || link.to.table === table;
const shortName = (table) => table.split('.').pop();
const linkText = (link) => `${shortName(link.from.table)}.${link.from.column} → ${shortName(link.to.table)}.${link.to.column}`;

function ColumnSelect({ label, value, columns, onChange }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={`${FIELD} font-mono`}>
      {!columns.includes(value) && <option value={value}>{value}</option>}
      {columns.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );
}

// One relationship the person keeps: change either column, or remove it. The source says where it came from.
function LinkRow({ link, columnsOf, onChange, onRemove }) {
  return (
    <li data-relationship={linkText(link)} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
      <span className="font-mono text-text-primary">{shortName(link.from.table)}</span>
      <ColumnSelect label={`Column of ${shortName(link.from.table)} in this relationship`} value={link.from.column}
        columns={columnsOf(link.from.table)} onChange={(column) => onChange({ ...link, from: { ...link.from, column } })} />
      <span className="text-text-tertiary">→</span>
      <span className="font-mono text-text-primary">{shortName(link.to.table)}</span>
      <ColumnSelect label={`Column of ${shortName(link.to.table)} in this relationship`} value={link.to.column}
        columns={columnsOf(link.to.table)} onChange={(column) => onChange({ ...link, to: { ...link.to, column } })} />
      <span data-link-source className="ms-auto text-text-secondary">{link.source}</span>
      <button type="button" aria-label={`Remove relationship ${linkText(link)}`} onClick={onRemove} className="text-text-tertiary hover:text-db-red-fg">
        <X size={12} />
      </button>
    </li>
  );
}

// The Relationships section of Data Management (REQ-362). The person picks a table; its relationships with the other picked tables are
// listed: the ones kept (editable), and the suggestions Inspire found (declared keys, then matching column names) to add.
export default function RelationshipsSection({ tables, relationships, onRelationships, apiFetch, warehouseId }) {
  const [selected, setSelected] = useState('');
  const [found, setFound] = useState({ status: 'idle' });
  const [manual, setManual] = useState(null);
  const tablesKey = tables.join('\n');
  const current = tables.includes(selected) ? selected : (tables[0] || '');

  useEffect(() => {
    if (!tables.length) { setFound({ status: 'idle' }); return undefined; }
    let cancelled = false;
    setFound({ status: 'loading' });
    withTimeout(apiFetch(`/api/relationships?warehouse_id=${encodeURIComponent(warehouseId || '')}`, {
      method: 'POST',
      body: JSON.stringify({ tables }),
    }), ANSWER_MS)
      .then((d) => { if (!cancelled) setFound({ status: 'done', tables: d.tables || {}, suggestions: d.suggestions || [] }); })
      .catch((e) => {
        if (cancelled) return;
        const permissions = Array.isArray(e.body?.permissions) ? e.body.permissions : [];
        setFound({ status: 'error', error: e.message || 'The relationships could not be read.', permissions });
        raisePermissions(permissions, { retry: () => setFound({ status: 'idle' }) });
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tablesKey, apiFetch, warehouseId]);

  const columnsOf = (table) => found.tables?.[table]?.columns || [];
  const kept = relationships.filter((l) => involves(l, current));
  const suggested = (found.suggestions || []).filter((s) => involves(s, current) && !relationships.some((l) => sameLink(l, s)));
  const replaceAt = (index, link) => onRelationships(relationships.map((l, i) => (i === index ? link : l)));
  const keep = (links) => onRelationships([...relationships, ...links.filter((s) => !relationships.some((l) => sameLink(l, s)))]);

  if (!tables.length) {
    return <p data-relationships-empty className="text-text-tertiary">Pick tables under Unity Catalog Metadata to see how they join.</p>;
  }
  const manualReady = manual && manual.from.table && manual.from.column && manual.to.table && manual.to.column;
  return (
    <div data-relationships className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-text-secondary">
          Table
          <select aria-label="Table to see relationships for" value={current} onChange={(e) => setSelected(e.target.value)} className={`${FIELD} font-mono`}>
            {tables.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        {suggested.length > 0 && (
          <button type="button" className={`${BUTTON} ms-auto`} onClick={() => keep(suggested)}>Add all {suggested.length} suggested</button>
        )}
      </div>
      {found.status === 'loading' && <p className="text-text-tertiary">Reading the keys and columns of the picked tables</p>}
      {found.status === 'error' && <PlainMessage role="alert" className="text-error-fg" text={found.error} />}
      {kept.length > 0 && (
        <ul aria-label={`Relationships of ${shortName(current)}`} className="grid gap-2">
          {kept.map((link) => (
            <LinkRow key={linkText(link)} link={link} columnsOf={columnsOf}
              onChange={(next) => replaceAt(relationships.indexOf(link), next)}
              onRemove={() => onRelationships(relationships.filter((l) => l !== link))} />
          ))}
        </ul>
      )}
      {suggested.length > 0 && (
        <ul aria-label={`Suggested relationships of ${shortName(current)}`} className="grid gap-2">
          {suggested.map((s) => (
            <li key={linkText(s)} data-suggested-relationship={linkText(s)} className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2">
              <span className="font-mono text-text-primary">{linkText(s)}</span>
              <span className="ms-auto text-text-secondary">{s.source}</span>
              <button type="button" className={BUTTON} onClick={() => keep([s])} aria-label={`Add suggested relationship ${linkText(s)}`}>Add</button>
            </li>
          ))}
        </ul>
      )}
      {found.status === 'done' && kept.length === 0 && suggested.length === 0 && (
        <p data-relationships-none className="text-text-secondary">No relationship found for {shortName(current)}. Add one by hand, or pick another table.</p>
      )}
      {!manual && found.status === 'done' && (
        <button type="button" className={BUTTON} onClick={() => setManual({ from: { table: current, column: '' }, to: { table: tables[0], column: '' } })}>
          Add a relationship
        </button>
      )}
      {manual && (
        <fieldset aria-label="New relationship" className="rounded-lg border border-border bg-surface p-2 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Table on the first side" value={manual.from.table} className={`${FIELD} font-mono`}
              onChange={(e) => setManual({ ...manual, from: { table: e.target.value, column: '' } })}>
              {tables.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select aria-label="Column on the first side" value={manual.from.column} className={`${FIELD} font-mono`}
              onChange={(e) => setManual({ ...manual, from: { ...manual.from, column: e.target.value } })}>
              <option value="">Pick a column</option>
              {columnsOf(manual.from.table).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <span className="text-text-tertiary">→</span>
            <select aria-label="Table on the second side" value={manual.to.table} className={`${FIELD} font-mono`}
              onChange={(e) => setManual({ ...manual, to: { table: e.target.value, column: '' } })}>
              {tables.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select aria-label="Column on the second side" value={manual.to.column} className={`${FIELD} font-mono`}
              onChange={(e) => setManual({ ...manual, to: { ...manual.to, column: e.target.value } })}>
              <option value="">Pick a column</option>
              {columnsOf(manual.to.table).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button type="button" className={BUTTON} disabled={!manualReady}
              onClick={() => { keep([{ from: manual.from, to: manual.to, source: MANUAL }]); setManual(null); }}>Add relationship</button>
            <button type="button" className={BUTTON} onClick={() => setManual(null)}>Cancel</button>
          </div>
        </fieldset>
      )}
    </div>
  );
}
