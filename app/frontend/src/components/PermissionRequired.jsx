import { useEffect, useRef, useState } from 'react';
import ModalDialog from './ModalDialog';
import { copyStepsText, copyText, grantAsk, grantListKey } from '../lib/permissionBus';
import { accessRequestResultText, checkAccessRequest, offerShown, sendAccessRequest, statementsOf } from '../lib/accessRequest';

const BUTTON = 'inline-flex h-8 items-center justify-center px-3 rounded-lg text-xs font-semibold border border-border bg-surface text-text-primary hover:bg-bg-subtle';
const COPY_LINE = 'Copy the text below and pass it on to your Databricks admin.';

export default function PermissionRequired({ permissions, onStart, onRetry, onClose }) {
  const [status, setStatus] = useState('');
  const [stepsStatus, setStepsStatus] = useState('');
  // REQ-311: Request for Access. The destinations are read once per grant list; the button shows only when one is set.
  const [offer, setOffer] = useState(null);
  const [requesting, setRequesting] = useState(false);
  const [requestText, setRequestText] = useState('');
  const box = useRef(null);
  const text = copyText(permissions);
  const granted = (permissions || []).filter((p) => (p?.statements || []).length > 0);
  // Copy steps: the folder Share and CLI steps. A note (a reason to rebuild) is plain text, shown once, never copied.
  const steps = copyStepsText(permissions);
  const notes = (permissions || []).flatMap((p) => p?.instructions || []);
  const asked = statementsOf(permissions);
  const listKey = grantListKey(permissions);
  useEffect(() => {
    setOffer(null);
    setRequestText('');
    if (!asked.length) return undefined;
    let live = true;
    checkAccessRequest(asked).then((got) => { if (live) setOffer(got); }).catch(() => { if (live) setOffer({ offered: false }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per grant list: the key stands for the statements
  }, [listKey]);
  const requestAccess = async () => {
    setRequesting(true);
    try {
      setRequestText(accessRequestResultText(await sendAccessRequest(asked)));
    } catch (err) {
      setRequestText(accessRequestResultText({ sent: false, reason: err?.message || '' }));
    } finally {
      setRequesting(false);
    }
  };
  const copySteps = async () => {
    try {
      await navigator.clipboard.writeText(steps);
      setStepsStatus('Copied');
    } catch {
      setStepsStatus('');
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Copied');
      return;
    } catch {
      // the Clipboard API is refused here, so select the statements and let the browser copy them
    }
    const range = document.createRange();
    range.selectNodeContents(box.current);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    setStatus(copied ? 'Copied' : 'Select and copy');
  };
  const buttons = (
    <>
      {offerShown(offer) && <button type="button" onClick={requestAccess} disabled={requesting} className={BUTTON}>{requesting ? 'Requesting' : 'Request access'}</button>}
      {text && <button type="button" onClick={copy} className={BUTTON}>{status === 'Copied' ? 'Copied' : 'Copy'}</button>}
      {steps && <button type="button" onClick={copySteps} className={BUTTON}>{stepsStatus === 'Copied' ? 'Copied' : 'Copy steps'}</button>}
      {onRetry && <button type="button" onClick={onRetry} className={BUTTON}>Try again</button>}
      {onStart && <button type="button" onClick={onStart} className={BUTTON}>Start anyway</button>}
    </>
  );
  return (
    <ModalDialog titleId="permission-required-title" title="Permission Required" onClose={onClose} overlayAttrs={{ 'data-permission-dialog': '' }}
      footer={buttons}>
      {(permissions || []).filter((p) => p?.why).map((p) => (
        <p key={`why-${p.why}`} className="text-sm text-text-secondary">{p.why}</p>
      ))}
      {text && <p className="text-sm text-text-primary">{COPY_LINE}</p>}
      {granted.length > 0 && (
        <div ref={box} data-permission-box="" className="max-h-56 overflow-y-auto rounded-md bg-bg-subtle p-3 space-y-3">
          {granted.map((p) => (
            <div key={[...p.statements, ...(p.instructions || [])].join('|')} className="space-y-1">
              <p className="text-xs font-semibold text-text-primary">{grantAsk(p)}</p>
              <pre data-permission-statements="" className="whitespace-pre-wrap break-all font-mono text-xs text-text-primary">{copyText([p])}</pre>
            </div>
          ))}
        </div>
      )}
      {steps && (
        <div data-permission-steps="" className="max-h-56 overflow-y-auto rounded-md bg-bg-subtle p-3">
          <pre className="whitespace-pre-wrap break-all font-mono text-xs text-text-primary">{steps}</pre>
        </div>
      )}
      {notes.length > 0 && (
        <div data-permission-notes="" className="space-y-1">
          {notes.map((note) => <p key={note} className="text-sm text-text-primary break-words">{note}</p>)}
        </div>
      )}
      {requestText && <p role="status" data-access-request-result="" className="text-sm text-text-primary break-words">{requestText}</p>}
      {status === 'Select and copy' && <p role="status" className="text-xs text-text-secondary">Select and copy: the statements are selected above.</p>}
    </ModalDialog>
  );
}
