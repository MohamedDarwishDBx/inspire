import { useState } from 'react';

export const PROGRESS_QUERY = 'progress';
const CHOICE_KEY = (scope) => `inspire.progress.${scope}`;

export function progressLinked(scope, search) {
  return scope != null && new URLSearchParams(search).get(PROGRESS_QUERY) === String(scope);
}

export function progressLink(scope, open, href) {
  const url = new URL(href);
  if (open) url.searchParams.set(PROGRESS_QUERY, String(scope));
  else if (url.searchParams.get(PROGRESS_QUERY) === String(scope)) url.searchParams.delete(PROGRESS_QUERY);
  return `${url.pathname}${url.search}${url.hash}`;
}

// The use case whose build the person started in this app, until its page opens the panel. Set when the build is submitted (markBuildPending).
const STARTED = new Map();
const START_MARK_MS = 2 * 60 * 1000;
export function noteBuildStarted(scope, now = Date.now()) {
  STARTED.set(String(scope), now);
}
function startedHere(scope, now = Date.now()) {
  const at = STARTED.get(String(scope));
  return at !== undefined && now - at < START_MARK_MS;
}

function rememberedChoice(scope) {
  try { return globalThis.sessionStorage?.getItem(CHOICE_KEY(scope)) ?? null; } catch { return null; }
}

function saveChoice(scope, open) {
  try { globalThis.sessionStorage?.setItem(CHOICE_KEY(scope), open ? 'open' : 'closed'); } catch { /* private mode: the panel opens again on the next load */ }
}

// The progress panel is closed on page load. It opens when the person opens it, or when a build starts (building turns true
// while this use case is shown). A choice the person made in this tab is remembered, so a reload keeps it.
export function useProgressView(scope, building = false) {
  const [view, setView] = useState({ scope: null, open: null, fromBuild: false });
  // A page that mounts after the build was submitted (the wizard hands over to a fresh page) already sees building true; the start mark opens it.
  const [seenBuilding, setSeenBuilding] = useState(() => building && !startedHere(scope));
  const chosen = view.scope === scope ? view.open : null;
  const fromBuild = view.scope === scope && view.fromBuild;
  const remembered = rememberedChoice(scope);
  const open = chosen ?? (progressLinked(scope, window.location.search) || (remembered ? remembered === 'open' : false));
  const keep = (next) => {
    saveChoice(scope, next);
    setView({ scope, open: next, fromBuild: false });
    const to = progressLink(scope, next, window.location.href);
    if (to !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, '', to);
  };
  if (building !== seenBuilding) {
    // A build that starts while this use case is shown opens the panel once (state adjusted during render, not in an effect).
    setSeenBuilding(building);
    if (building) {
      STARTED.delete(String(scope));
      setView({ scope, open: true, fromBuild: true });
    }
  }
  return { open, fromBuild, show: () => keep(true), close: () => keep(false) };
}
