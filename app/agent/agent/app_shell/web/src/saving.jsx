import { useSyncExternalStore } from 'react';
import { SLOW_MS, listen, read, runWrite } from './writeGate.js';

export { SLOW_MS, runWrite };
export const SAVING = 'Saving…';
export const STILL_SAVING = 'Still saving…';

export function useWrite() {
  const state = useSyncExternalStore(listen, read, read);
  return {
    busy: !!state.key, slow: state.slow,
    mine: (key) => !!state.key && state.key === String(key),
    holds: (key) => !!state.key && key != null && state.rows.includes(String(key)),
  };
}

export const savingLabel = (slow) => (slow ? STILL_SAVING : SAVING);

export function Saving({ slow }) {
  return <><span className="saving-ring" aria-hidden="true" />{savingLabel(slow)}</>;
}

export const missingWhy = (parts) => {
  const list = parts.filter(Boolean);
  return list.length ? `Add ${list.join(' and ')} to save.` : '';
};

export function SaveButton({ write, disabled, why = '', children, className = 'btn', type = 'button', ...rest }) {
  const gate = useWrite();
  const mine = gate.mine(write);
  const off = !!disabled || gate.busy;
  const reason = disabled && !gate.busy ? why : '';
  return (
    <>
      <button type={type} className={className} {...rest} disabled={off} title={reason || undefined} aria-busy={mine || undefined} data-saving={mine ? '' : undefined}>
        {mine ? <Saving slow={gate.slow} /> : children}
      </button>
      {reason && <small className="save-why" data-save-missing>{reason}</small>}
    </>
  );
}
