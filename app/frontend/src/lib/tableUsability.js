// REQ-180 (fail closed): a table whose type the backend could not read is shown as not usable, with its plain reason, and is
// never picked. The backend says so with usable:false and unusable_reason on a table row, and with an unusable list on swaps.

export const UNUSABLE_TYPE_FALLBACK = "Inspire could not read this table's type, so it cannot be used here. Pick another table you can read.";

/** The reason a listed table cannot be picked, or '' when it can be. Only usable:false blocks a pick. */
export function unusableReasonOf(row) {
  if (!row || row.usable !== false) return '';
  return String(row.unusable_reason || UNUSABLE_TYPE_FALLBACK);
}

/** The one plain line for the tables a schema listing left out past its cap, or '' when none were left out. */
export function leftOutLine(left) {
  const count = Number(left?.count) || 0;
  if (!count) return '';
  const schema = String(left.schema || 'this schema');
  return `${count} ${count === 1 ? 'table' : 'tables'} in ${schema} ${count === 1 ? 'was' : 'were'} left out of this list: Inspire lists at most 1000 tables from one schema.`;
}

/** The backend's unusable swap candidates as swap rows that cannot be chosen. */
export function unusableSwapRows(list) {
  return (list || []).map((u) => ({ table: u.table, usable: false, unusable_reason: u.reason || UNUSABLE_TYPE_FALLBACK, matched: 0, total: 0, copy: false }));
}
