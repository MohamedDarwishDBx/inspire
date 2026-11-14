// What a person reads when a Databricks call Inspire makes is refused or fails. The API body (JSON or text) goes to the
// server log only: the person reads one plain sentence that says what failed, never the body itself.
function apiRefusalText(action, status) {
  const code = Number(status);
  if (code === 403) {
    return `Inspire could not ${action}: the service refused it, so your sign-in or the App lacks a permission it needs. `
      + 'Ask an App manager to check the grants, then try again.';
  }
  if (code === 404) return `Inspire could not ${action}: the service cannot find it.`;
  return `Inspire could not ${action}: the service answered with HTTP ${code || 'an error'}. Try again, and tell an App manager if it repeats.`;
}

function logApiBody(action, status, body) {
  console.error(`${action} failed (HTTP ${status}): ${String(body || '').slice(0, 1200)}`);
}

module.exports = { apiRefusalText, logApiBody };
