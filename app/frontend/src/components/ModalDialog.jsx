import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import BodyPortal from './BodyPortal';
import { useModal } from './useModal';

// The one centered modal dialog. Escape closes it, the header with its Close button stays in view while the body scrolls,
// and the behaviour comes from useModal.
export default function ModalDialog({ titleId, title, onClose, overlayAttrs = {}, dialogAttrs = {}, overlayClass = 'z-50 bg-black/30',
  widthClass = 'max-w-lg', footer = null, children }) {
  const panel = useRef(null);
  useModal(panel, onClose);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });

  return (
    <BodyPortal>
      <div className={`fixed inset-0 flex items-center justify-center p-4 ${overlayClass}`} {...overlayAttrs}>
        <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} {...dialogAttrs}
          className={`flex max-h-[calc(100dvh-2rem)] w-full ${widthClass} flex-col rounded-xl border border-border bg-surface shadow-xl outline-none`}>
          <div className="flex shrink-0 items-start gap-3 border-b border-border px-5 pt-5 pb-3">
            <h2 id={titleId} className="min-w-0 flex-1 text-base font-bold text-text-primary">{title}</h2>
            <button type="button" onClick={() => closeRef.current?.()} aria-label="Close" title="Close (Esc)"
              className="shrink-0 rounded-md p-1.5 text-text-secondary hover:bg-bg-subtle">
              <X size={16} />
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
          {footer && (
            <div className="shrink-0 flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>
          )}
        </div>
      </div>
    </BodyPortal>
  );
}
