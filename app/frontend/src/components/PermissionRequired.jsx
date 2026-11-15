import { useRef, useState } from 'react';
import ModalDialog from './ModalDialog';
import { copyText, grantAsk } from '../lib/permissionBus';

const BUTTON = 'inline-flex h-8 items-center justify-center px-3 rounded-lg text-xs font-semibold border border-border bg-surface text-text-primary hover:bg-bg-subtle';
const COPY_LINE = 'Copy the text below and pass it on to your Databricks admin.';

export default function PermissionRequired({ permissions, onStart, onRetry, onClose }) {
  const [status, setStatus] = useState('');
  const box = useRef(null);
  const text = copyText(permissions);
  const granted = (permissions || []).filter((p) => (p?.statements || []).length > 0);
  // A non-grant step (a reason to rebuild, a folder step) is plain text: it is shown once and never copied.
  const steps = (permissions || []).flatMap((p) => p?.instructions || []);
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
      {text && <button type="button" onClick={copy} className={BUTTON}>{status === 'Copied' ? 'Copied' : 'Copy'}</button>}
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
      {steps.length > 0 && (
        <div data-permission-steps="" className="space-y-1">
          {steps.map((step) => <p key={step} className="text-sm text-text-primary break-words">{step}</p>)}
        </div>
      )}
      {status === 'Select and copy' && <p role="status" className="text-xs text-text-secondary">Select and copy: the statements are selected above.</p>}
    </ModalDialog>
  );
}
