// REQ-311: the pure rules of the Permission Required dialog's Request access, shared by the App and the MVP shell. No imports.

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

// REQ-406: Request access always opens the Databricks request form when the in-App send does not go through. The form is the Catalog
// Explorer page of the first securable (the backend builds it), and the rest are listed as plain links. The person sees one plain line,
// never a raw API error.
export function requestFormLink(links) {
  return (Array.isArray(links) ? links : []).find((link) => link && link.url) || null;
}

export function otherRequestLinks(links) {
  return (Array.isArray(links) ? links : []).filter((link) => link && link.url).slice(1);
}

export function requestFormText(link) {
  return link ? `Opened the access request form for ${link.full_name} in a new tab. Send the request there.`
    : 'Copy the SQL under Advanced to request this access.';
}
