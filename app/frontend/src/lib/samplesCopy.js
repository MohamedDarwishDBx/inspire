import { scopeKeyOf } from './tableScope.js';

export const SAMPLE_CATALOG = 'samples';
export const SAMPLES_DESCRIPTIONS_SENTENCE = 'Value cannot be measured on samples, so this run reads only the table descriptions.';

const unique = (names) => [...new Set(names)];

// The Table Scopes follow their tables into the copies: a scope saved on samples.x is re-keyed to the copy that now holds x, so the
// launch sends it under the name the run reads (REQ-242). A failed copy keeps its scope under the source name it was picked by.
export function scopesAfterSampleCopies(scopes, copies) {
  const copyOf = new Map((copies || []).map(({ source, copy }) => [scopeKeyOf(source), copy]));
  const out = {};
  for (const [table, entry] of Object.entries(scopes || {})) {
    const copy = copyOf.get(scopeKeyOf(table));
    out[copy || table] = entry;
  }
  return out;
}

export const isSampleEntry = (name) => String(name || '').trim().split('.')[0] === SAMPLE_CATALOG;

export const samplesTarget = (inspireDatabase, typed) => {
  if (typed != null && String(typed).trim() !== '') return String(typed).trim();
  const db = String(inspireDatabase || '').trim();
  return db && !isSampleEntry(db) ? db : '';
};

export const validCopyTarget = (text) => /^[^\s.`]+\.[^\s.`]+$/.test(String(text || '').trim()) && !isSampleEntry(text);

export function applySampleCopies(picks, { destination, copies, failed }) {
  const keep = (names) => names.filter((name) => !isSampleEntry(name));
  const catalogs = keep(picks.catalogs);
  const schemas = keep(picks.schemas);
  for (const { source } of failed) {
    const [catalog, schema] = source.split('.');
    catalogs.push(catalog);
    schemas.push(`${catalog}.${schema}`);
  }
  if (copies.length) {
    catalogs.push(destination.split('.')[0]);
    schemas.push(destination);
  }
  return {
    catalogs: unique(catalogs),
    schemas: unique(schemas),
    tables: unique([...keep(picks.tables), ...failed.map((f) => f.source), ...copies.map((c) => c.copy)]),
  };
}
