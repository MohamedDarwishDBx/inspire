// REQ-311: Request for Access from the Permission Required dialog. The check reads the destinations once per dialog; the send files the
// request as the signed-in person. Both pass the dialog's GRANT statements, and the backend keeps only the grants made to that person.
import { makeApiPostJson } from './apiClient.js';

const post = makeApiPostJson({});

// raise: false keeps a refusal on the caller's side, so the dialog shows its own plain reason and never opens over itself.
export const checkAccessRequest = (statements) => post('/api/access-request/check', { statements }, { raise: false });
export const sendAccessRequest = (statements) => post('/api/access-request', { statements }, { raise: false });

// The button is offered only when a destination is set for a securable the person can request.
export function offerShown(offer) {
  return Boolean(offer && offer.offered === true);
}

// The one plain line after a send: where the request went, or why it was not sent.
export function accessRequestResultText(result) {
  if (!result) return '';
  if (result.sent) {
    const where = Array.isArray(result.destinations) ? result.destinations.filter(Boolean).join(', ') : '';
    return where ? `Request sent to ${where}` : 'Request sent';
  }
  const reason = String(result.reason || '').trim();
  return reason ? `Request not sent: ${reason}` : 'Request not sent';
}

// The grant statements the dialog shows, in their dialog order, for the check and the send.
export function statementsOf(permissions) {
  return (permissions || []).flatMap((p) => (Array.isArray(p?.statements) ? p.statements : []));
}
