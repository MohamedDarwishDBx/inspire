import { useEffect, useState } from 'react';
import { WAITING_FOR_ACCESS_TITLE } from './api.js';
import { ACCESS_CHECKED } from './ui.jsx';
import PermissionDialog from './PermissionDialog.jsx';
import { waitingAskOf } from './plainText.js';

export const WAITING_REASON = 'The App cannot read the tables this page uses yet, so its numbers and records stay empty until access is granted.';

// REQ-310/311: every access failure of the MVP App opens the Permission Required dialog (PermissionDialog), never a plain waiting card.
// reason overrides the one line the dialog shows above its block (the no-access banner passes its own sentence).
export default function WaitingForAccess({ waiting, onCheck, compact = false, reason }) {
  const [open, setOpen] = useState(true);
  // A check (Check again in the dialog's Advanced section) reloads the page through onCheck, as before.
  useEffect(() => {
    if (!onCheck) return undefined;
    const again = () => onCheck();
    window.addEventListener(ACCESS_CHECKED, again);
    return () => window.removeEventListener(ACCESS_CHECKED, again);
  }, [onCheck]);
  const text = reason ?? `${WAITING_REASON} ${waitingAskOf(waiting?.owners)}`;
  if (!open) {
    return (
      <p className="tile-err" role="status" aria-label={WAITING_FOR_ACCESS_TITLE} data-waiting-for-access="" data-waiting-compact={compact ? '' : undefined}>
        {text} <button type="button" className="lnk" onClick={() => setOpen(true)} data-permission-open="">Permission Required</button>
      </p>
    );
  }
  return <PermissionDialog found={waiting?.access} reason={text} title={WAITING_FOR_ACCESS_TITLE} onClose={() => setOpen(false)} inline={compact} />;
}
