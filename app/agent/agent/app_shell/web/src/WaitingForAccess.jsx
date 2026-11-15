import { useEffect, useState } from 'react';
import { WAITING_FOR_ACCESS_TITLE, appAccess } from './api.js';
import { ACCESS_CHECKED } from './ui.jsx';
import PermissionDialog from './PermissionDialog.jsx';
import { waitingAskOf } from './plainText.js';

export const WAITING_REASON = 'The App cannot read the tables this page uses yet, so its numbers and records stay empty until access is granted.';

// REQ-311: every access failure of the MVP App opens the Permission Required dialog (PermissionDialog), never a plain waiting card.
// The grants are read from the server (diagnose) when the caller did not pass them, and a check reads them again.
export default function WaitingForAccess({ waiting, onCheck, compact = false }) {
  const ask = waitingAskOf(waiting?.owners);
  const [found, setFound] = useState(waiting?.access || null);
  const [open, setOpen] = useState(true);
  const [again, setAgain] = useState(0);
  useEffect(() => {
    let live = true;
    appAccess('diagnose').then((got) => { if (live) setFound(got); }).catch(() => { if (live) setFound(null); });
    return () => { live = false; };
  }, [again]);
  useEffect(() => {
    const check = () => setAgain((n) => n + 1);
    window.addEventListener(ACCESS_CHECKED, check);
    return () => window.removeEventListener(ACCESS_CHECKED, check);
  }, []);
  const checkAgain = () => { setAgain((n) => n + 1); onCheck?.(); };
  const reason = `${WAITING_REASON} ${ask}`;
  if (!open) {
    return (
      <p className="tile-err" role="status" aria-label={WAITING_FOR_ACCESS_TITLE} data-waiting-for-access="" data-waiting-compact={compact ? '' : undefined}>
        {WAITING_REASON} <button type="button" className="lnk" onClick={() => setOpen(true)} data-permission-open="">Permission Required</button>
      </p>
    );
  }
  return <PermissionDialog found={found} reason={reason} title={WAITING_FOR_ACCESS_TITLE} onCheck={checkAgain} onClose={() => setOpen(false)} />;
}
