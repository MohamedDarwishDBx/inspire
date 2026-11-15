// One channel from every failed request to the App-level Permission Required dialog.
// A raise with no subscriber is kept and replayed to the first subscriber, so a grant that fails before the host mounts is not lost.
// A grant list (its GRANT statements, sorted) opens the dialog once per session: a re-check, a poll or a reload that returns the same grants
// merges into the open dialog or stays closed. A new grant opens it. An explicit action (explicit: true) always opens.
// Every GRANT statement the dialog has shown this session: a raise opens the dialog only for a statement it has not shown yet.
// The memory lives in sessionStorage when the browser has it, so a reload or a new page load in the same tab does not reopen a list the
// person already saw. Without storage (tests, private modes that refuse it) it falls back to this module's memory.
const SHOWN_KEY = 'inspire.permissionStatementsShown';
const memory = new Set();
let pending = null;

function storageOrNull() {
  try { return globalThis.sessionStorage || null; } catch { return null; }
}

function isShown(statement) {
  if (memory.has(statement)) return true;
  const storage = storageOrNull();
  if (!storage) return false;
  try {
    const saved = JSON.parse(storage.getItem(SHOWN_KEY) || '[]');
    return Array.isArray(saved) && saved.includes(statement);
  } catch { return false; }
}

function markShown(statements) {
  statements.forEach((s) => memory.add(s));
  const storage = storageOrNull();
  if (!storage) return;
  try {
    const saved = new Set(JSON.parse(storage.getItem(SHOWN_KEY) || '[]'));
    statements.forEach((s) => saved.add(s));
    storage.setItem(SHOWN_KEY, JSON.stringify([...saved]));
  } catch { /* storage refused: the in-module memory still holds */ }
}

// The identity of a grant list is its content, so the same grants in another order, or as a new object, are the same list.
export function grantListKey(permissions) {
  if (!Array.isArray(permissions) || !permissions.length) return '';
  return JSON.stringify(permissions.map((p) => JSON.stringify([...(p?.statements || [])].sort())).sort());
}

// REQ-216, REQ-131: an optional grant (the App reads Delta until an admin runs it) stays in the dialog with its Copy button, labelled optional.
// It never gates a build: the submit does not depend on the dialog being open or closed.
export function grantAsk(p) {
  if (p?.optional) return 'Optional: pages load faster once your admin runs this.';
  return `Ask your admin to grant this permission${p?.principal ? ` to ${p.principal}` : ''}:`;
}

// One host shows the dialog. A host mounted later takes over, so two mounted hosts never stack two dialogs for one raise.
let activeHost = null;
export function subscribePermissions(fn) {
  activeHost = fn;
  if (pending) {
    const { permissions, extra } = pending;
    pending = null;
    fn(permissions, extra);
  }
  return () => { if (activeHost === fn) activeHost = null; };
}

export function raisePermissions(permissions, extra = {}, { explicit = false } = {}) {
  if (!Array.isArray(permissions) || !permissions.length) return;
  const statements = permissions.flatMap((p) => p?.statements || []);
  const seen = statements.length > 0 && statements.every(isShown);
  markShown(statements);
  if (seen && !explicit) {
    // The same grants again: never reopen. An open dialog for them takes this raise's extras (Try again, Start) through a quiet notice.
    if (activeHost) activeHost(permissions, extra, { quiet: true });
    return;
  }
  if (!activeHost) {
    pending = { permissions, extra };
    return;
  }
  activeHost(permissions, extra);
}
