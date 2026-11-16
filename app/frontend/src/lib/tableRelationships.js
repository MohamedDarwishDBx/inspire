// The joins the person draws between picked tables on the Launch page (REQ-373). The run reads them as one widget, 18_table_relationships:
// a JSON list of { from: { table, column }, to: { table, column } }, where `from` is the foreign-key side. The agent notebook uses these
// joins before any declared key or name match, and reads each linked group of tables as one joined dataset.
import { scopeKeyOf } from './tableScope.js';

const text = (v) => (v == null ? '' : String(v).trim());

// A side names a catalog.schema.table and one column of it. Anything else is not a join the run can use.
function sideOf(value) {
  if (!value || typeof value !== 'object') return null;
  const table = text(value.table).replace(/`/g, '');
  const column = text(value.column);
  const parts = table.split('.').map((p) => p.trim());
  if (parts.length !== 3 || parts.some((p) => !p)) return null;
  if (!column) return null;
  return { table: parts.join('.'), column };
}

/** One relationship as the run reads it, or null when either side is not a table and column. */
export function normalizeRelationship(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const from = sideOf(entry.from);
  const to = sideOf(entry.to);
  return from && to ? { from, to } : null;
}

const relationKey = (r) => scopeKeyOf(`${r.from.table}.${r.from.column}>${r.to.table}.${r.to.column}`);

/**
 * Parses the widget text or a parsed list. Returns { relations, problems }: the valid relationships, de-duplicated, and one problem
 * per entry that is not a join (the backend refuses the launch with them).
 */
export function relationshipsFromObject(value) {
  if (value == null) return { relations: [], problems: [] };
  if (!Array.isArray(value)) return { relations: [], problems: ['The relationships must be a list.'] };
  const relations = [];
  const problems = [];
  const seen = new Set();
  value.forEach((entry, index) => {
    const relation = normalizeRelationship(entry);
    if (!relation) {
      problems.push(`Relationship ${index + 1} needs a catalog.schema.table name and a column on each side.`);
      return;
    }
    const key = relationKey(relation);
    if (seen.has(key)) return;
    seen.add(key);
    relations.push(relation);
  });
  return { relations, problems };
}

/**
 * The 18_table_relationships text a launch sends: only the joins whose both tables the run reads (pickedTables, the tables the run
 * reads, as launchTableScopeText picks them). Empty text when no join applies, so the notebook gets no widget value.
 */
export function launchRelationshipsText(relationships, pickedTables = []) {
  const picked = new Set(pickedTables.map(scopeKeyOf));
  const kept = [];
  const seen = new Set();
  for (const entry of Array.isArray(relationships) ? relationships : []) {
    const relation = normalizeRelationship(entry);
    if (!relation) continue;
    if (!picked.has(scopeKeyOf(relation.from.table)) || !picked.has(scopeKeyOf(relation.to.table))) continue;
    const key = relationKey(relation);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(relation);
  }
  return kept.length ? JSON.stringify(kept) : '';
}
