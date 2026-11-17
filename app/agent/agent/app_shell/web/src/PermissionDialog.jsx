import { useEffect, useRef, useState } from 'react';
import { copyText as grantText } from '../../../../../frontend/src/lib/permissionBus.js';
import { accessRequestResultText, offerShown, otherRequestLinks, requestFormLink, requestFormText } from '../../../../../frontend/src/lib/accessRequestText.js';
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
  // REQ-408: the copy text is the server's schema-level display; Grant still runs the exact statements of the found tables.
  const text = found?.display || grantText([{ statements }]);
  const checkRef = useRef(null);
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
    checkRef.current = null;
    if (!statements.length) return undefined;
    let live = true;
    const pending = accessRequestCheck().catch(() => ({ offered: false, links: [] }));
    checkRef.current = pending;
    pending.then((got) => { if (live) setOffer(got); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per grant list: the key stands for the statements
  }, [key]);
  // REQ-406: a send goes out only when the check offers it. Any other outcome opens the Databricks request form for the first securable in
  // a new tab, with one plain line (never a raw API error), the same rule as the Inspire App's dialog.
  const requestAccess = async () => {
    setRequesting(true);
    let got = {};
    let sent = null;
    try {
      got = (await checkRef.current) || {};
      if (offerShown(got)) sent = await accessRequestSend();
    } catch {
      sent = null;
    }
    if (sent?.sent) {
      setResult(accessRequestResultText(sent));
    } else {
      const links = sent?.links?.length ? sent.links : (got.links || []);
      const first = requestFormLink(links);
      if (first) {
        try { window.open(first.url, '_blank', 'noopener,noreferrer'); } catch { /* the browser refused the tab: the line still names the object */ }
      }
      setResult(requestFormText(first));
    }
    setRequesting(false);
  };
  const copy = async () => setCopied((await copyText(text)) ? 'Copied' : 'Select and copy');
  return (
    <div className={inline ? 'perm-dialog-inline' : 'perm-dialog-backdrop'} data-permission-dialog="">
      <section className="card perm-dialog" role={inline ? 'region' : 'dialog'} aria-modal={inline ? undefined : 'true'} aria-labelledby="perm-dialog-title">
        <h2 id="perm-dialog-title">{title}</h2>
        {reason && <p>{reason}</p>}
        <div className="perm-dialog-actions">
          {statements.length > 0 && <button type="button" className="btn btn--sm btn--pri" onClick={requestAccess} disabled={requesting} data-request-access="">{requesting ? 'Requesting' : 'Request access'}</button>}
          {onClose && <button type="button" className="btn btn--sm" onClick={onClose} data-permission-close="">Close</button>}
        </div>
        {result && <p role="status" data-access-request-result="">{result}</p>}
        {otherRequestLinks(offer?.links).length > 0 && (
          <div data-request-links="">
            <p>Also request access on:</p>
            {otherRequestLinks(offer.links).map((link) => <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer">{link.full_name}</a>)}
          </div>
        )}
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
