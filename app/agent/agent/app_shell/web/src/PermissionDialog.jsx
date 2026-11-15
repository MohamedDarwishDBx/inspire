import { useEffect, useState } from 'react';
import { copyText as grantText } from '../../../../../frontend/src/lib/permissionBus.js';
import { accessRequestResultText, offerShown } from '../../../../../frontend/src/lib/accessRequestText.js';
import { accessRequestCheck, accessRequestSend } from './api.js';
import { copyText } from './Draft.jsx';
import { AccessActions } from './ui.jsx';

// REQ-311: the Permission Required dialog of the MVP App. Same content and rules as the Inspire App's dialog: one instruction line,
// a scrollable block with only the GRANT statements, Copy, and Request access when a destination exists. The App's own grant flow
// (AccessActions) stays below it, unchanged.
export const COPY_LINE = 'Copy the text below and pass it on to your Databricks admin.';

export default function PermissionDialog({ found, reason = '', title = 'Permission Required', onClose, onCheck }) {
  const statements = (found?.tables || []).flatMap((t) => t.grants || []);
  const key = statements.join('|');
  const text = grantText([{ statements }]);
  const [offer, setOffer] = useState(null);
  const [requesting, setRequesting] = useState(false);
  const [result, setResult] = useState('');
  const [copied, setCopied] = useState('');
  useEffect(() => {
    setOffer(null);
    setResult('');
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
    <div className="perm-dialog-backdrop" data-permission-dialog="">
      <section className="card perm-dialog" role="dialog" aria-modal="true" aria-labelledby="perm-dialog-title">
        <h2 id="perm-dialog-title">{title}</h2>
        {statements.length > 0 && <p>{COPY_LINE}</p>}
        {reason && <p>{reason}</p>}
        {statements.length > 0 && (
          <pre className="perm-dialog-block mono" data-permission-statements="">{text}</pre>
        )}
        <div className="perm-dialog-actions">
          {statements.length > 0 && <button type="button" className="btn btn--sm" onClick={copy} data-permission-copy="">{copied === 'Copied' ? 'Copied' : 'Copy'}</button>}
          {offerShown(offer) && <button type="button" className="btn btn--sm btn--pri" onClick={requestAccess} disabled={requesting} data-request-access="">{requesting ? 'Requesting' : 'Request access'}</button>}
          {onCheck && <button type="button" className="btn btn--sm" onClick={onCheck}>Check again</button>}
          {onClose && <button type="button" className="btn btn--sm" onClick={onClose} data-permission-close="">Close</button>}
        </div>
        {copied === 'Select and copy' && <p role="status">Select and copy: the statements are selected above.</p>}
        {result && <p role="status" data-access-request-result="">{result}</p>}
        <AccessActions access={found} />
      </section>
    </div>
  );
}
