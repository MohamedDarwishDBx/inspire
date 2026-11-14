import { CHANGE_LABEL } from '../lib/implementWizard';

// A Change row: the summary stays on the line, and the children appear only when the row is open.
export default function Advanced({ open, onToggle, children, summary = '', what = 'settings' }) {
  return (
    <div className="border-t border-border pt-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] text-text-secondary min-w-0">{summary}</p>
        <button type="button" aria-expanded={open} aria-label={`${open ? 'Close' : CHANGE_LABEL} ${what}`} onClick={onToggle}
          className="shrink-0 text-xs font-medium text-db-red-fg hover:underline glow-focus">
          {open ? 'Close' : CHANGE_LABEL}
        </button>
      </div>
      {open && <div className="space-y-4">{children}</div>}
    </div>
  );
}
