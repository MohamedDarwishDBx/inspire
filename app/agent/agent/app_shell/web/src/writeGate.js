// The one write gate of the App shell. One write runs at a time and the gate names the one in flight, so SaveButtons show it.
// A write that starts while another is in flight waits its turn in order, so it always lands and never returns undefined.
// A repeat of a write that is still in flight or queued (same key: a double click, a second press of the same key) joins that write and
// sends nothing new, so the person's one press is one write. Different keys queue in order.
// A write nested inside the running one (inside: true) runs at once, because the outer write already holds the gate.
// Plain module (no React) so the gate is testable in node; saving.jsx re-exports runWrite.
export const SLOW_MS = 10000;
const IDLE = { key: '', rows: [], slow: false };
export let now = IDLE;
export const heard = new Set();
export const tell = (next) => { now = next; heard.forEach((f) => f()); };
export const listen = (f) => { heard.add(f); return () => heard.delete(f); };
export const read = () => now;

let turns = Promise.resolve();
const pending = new Map();

async function holdGate(key, fn, rows) {
  const mine = String(key);
  tell({ key: mine, rows: (rows || []).map(String), slow: false });
  const timer = setTimeout(() => { if (now.key === mine) tell({ ...now, slow: true }); }, SLOW_MS);
  try {
    return await fn();
  } finally {
    clearTimeout(timer);
    if (now.key === mine) tell(IDLE);
  }
}

export function runWrite(key, fn, { rows = [], inside = false } = {}) {
  if (inside && now.key) return fn();
  const id = String(key);
  if (pending.has(id)) return pending.get(id);
  const turn = () => holdGate(id, fn, rows);
  const run = turns.then(turn, turn);
  turns = run.catch(() => {});
  pending.set(id, run);
  const done = () => { if (pending.get(id) === run) pending.delete(id); };
  run.then(done, done);
  return run;
}
