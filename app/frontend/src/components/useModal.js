import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Modal dialogs open over one another. Only the one on top reacts to Escape and to Tab, so one Escape closes one dialog.
const openStack = [];

// Shared modal behaviour: Escape closes, focus moves in on open and returns to the opener on close, and Tab stays inside the
// panel while it is open and on top. `enabled` turns the whole behaviour off (for non-modal drawers); `escape` and `trap` split it.
export function useModal(panel, onClose, { enabled = true, escape = true, trap = true } = {}) {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    if (!enabled) return undefined;
    const token = {};
    openStack.push(token);
    const opener = document.activeElement;
    if (panel.current && !panel.current.contains(document.activeElement)) {
      (panel.current.querySelector(FOCUSABLE) || panel.current).focus({ preventScroll: true });
    }
    const onKey = (e) => {
      if (openStack[openStack.length - 1] !== token) return;
      if (e.key === 'Escape') {
        if (!escape || e.defaultPrevented) return;
        e.preventDefault();
        closeRef.current?.();
        return;
      }
      if (e.key !== 'Tab' || !trap || !panel.current) return;
      const items = [...panel.current.querySelectorAll(FOCUSABLE)];
      if (!items.length) { e.preventDefault(); panel.current.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const outside = !panel.current.contains(active);
      if (e.shiftKey && (active === first || outside)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || outside)) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const at = openStack.indexOf(token);
      if (at >= 0) openStack.splice(at, 1);
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [enabled, escape, trap, panel]);
}

