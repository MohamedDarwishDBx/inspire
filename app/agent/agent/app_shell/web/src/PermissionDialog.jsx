import { useEffect, useState } from 'react';
import { copyText as grantText } from '../../../../../frontend/src/lib/permissionBus.js';
import { accessRequestResultText, offerShown } from '../../../../../frontend/src/lib/accessRequestText.js';
import { accessRequestCheck, accessRequestSend } from './api.js';
import { copyText } from './Draft.jsx';
import { AccessActions } from './ui.jsx';

// REQ-310/311/313: the Permission Required dialog of the MVP App, the same content and rules as the Inspire App's dialog. One plain reason,
// Request access as the primary action, and the SQL under Advanced with its one instruction line. Advanced opens by default when no
// destination exists. found: the grants the server reads (omitted: the dialog reads them itself and again after any check).
export const ADVANCED_LINE = 'Copy the SQL below and send it to your Databricks admin.';

export default function PermissionDialog({ found: given, reason = '', title = 'Permission Required', onClose, inline = false }) {
  const [own, setOwn] = useState(null);
  const found = given !== undefined ? given : own;
  const statements = (found?.tables || []).flatMap((t) => t.grants || []);
  const key = statements.join('|');
  const text = grantText([{ statements }]);
  const [offer, setOffer] = useState(null);
  const [advancedState, setAdvancedState] = useState(null);
  const [requesting, setRequesting] = useState(false);
  const [result, setResult] = useState('');
  const [copied, setCopied] = useState('');
  // Advanced opens when no destination exists, and when there are no grants to ask about (so Check again stays reachable).
  const advancedOpen = advancedState ?? (offer !== null ? !offerShown(offer) : statements.length === 0);
  useEffect(() => {
    setOffer(null);
    setResult('');
    setAdvancedState(null);
    if (!statements.length) return undefined;
    let live = true;
    accessRequestCheck().then((got) => { if (live) setOffer(got); }).catch(() => { if (live) setOffer({ offered: false }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per grant list: the key stands for the statements
  }, [key]);
  const requestAccess = async () => {
    setRequesting(true);
    try {
      setResult(accessRequestResultText(await accessRequestSend()));
    } catch (error) {
      setResult(accessRequestResultText({ sent: false, reason: error?.message || '' }));
    } finally {
      setRequesting(false);
    }
  };
  const copy = async () => setCopied((await copyText(text)) ? 'Copied' : 'Select and copy');
  return (
    <div className={inline ? 'perm-dialog-inline' : 'perm-dialog-backdrop'} data-permission-dialog="">
      <section className="card perm-dialog" role={inline ? 'region' : 'dialog'} aria-modal={inline ? undefined : 'true'} aria-labelledby="perm-dialog-title">
        <h2 id="perm-dialog-title">{title}</h2>
        {reason && <p>{reason}</p>}
        <div className="perm-dialog-actions">
          {offerShown(offer) && <button type="button" className="btn btn--sm btn--pri" onClick={requestAccess} disabled={requesting} data-request-access="">{requesting ? 'Requesting' : 'Request access'}</button>}
          {onClose && <button type="button" className="btn btn--sm" onClick={onClose} data-permission-close="">Close</button>}
        </div>
        {result && <p role="status" data-access-request-result="">{result}</p>}
        <details className="perm-dialog-advanced" data-permission-advanced="" open={advancedOpen} onToggle={(e) => setAdvancedState(e.currentTarget.open)}>
          <summary>Advanced</summary>
          {statements.length > 0 && <p>{ADVANCED_LINE}</p>}
          {statements.length > 0 && <pre className="perm-dialog-block mono" data-permission-statements="">{text}</pre>}
          {statements.length > 0 && (
            <div className="perm-dialog-actions">
              <button type="button" className="btn btn--sm" onClick={copy} data-permission-copy="">{copied === 'Copied' ? 'Copied' : 'Copy'}</button>
            </div>
          )}
          {copied === 'Select and copy' && <p role="status">Select and copy: the statements are selected above.</p>}
          <AccessActions access={given} onFound={setOwn} />
        </details>
      </section>
    </div>
  );
}
