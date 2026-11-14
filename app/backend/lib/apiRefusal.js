const { parseExactJson } = require('./exactJson');
const { redactSecrets } = require('./redact');

const REASON_CAP = 300;

// The platform's own reason for a refusal: its human message (or error_description), redacted and capped. The JSON
// envelope, error_code and request_id never reach the person. Text that is not JSON is taken as the reason itself.
function platformReasonOf(body) {
  const text = String(body ?? '').trim();
  if (!text) return '';
  let reason = text;
  if (/^[{[]/.test(text)) {
    try {
      const parsed = parseExactJson(text);
      reason = parsed && typeof parsed === 'object'
        ? (typeof parsed.message === 'string' ? parsed.message : (typeof parsed.error_description === 'string' ? parsed.error_description : ''))
        : '';
    } catch {
      reason = '';
    }
  }
  return redactSecrets(reason).replace(/\s+/g, ' ').trim().replace(/\.$/, '').slice(0, REASON_CAP);
}

// What a person reads when a call to the service fails: the reason the service gave, else a plain status sentence.
function apiRefusalText(action, status, body) {
  const code = Number(status);
  const reason = platformReasonOf(body);
  if (code === 403) {
    const because = reason ? `${reason}. ` : '';
    return `Inspire could not ${action}: ${because}Your sign-in or the App lacks a permission it needs. `
      + 'Ask an App manager to check the grants, then try again.';
  }
  if (reason) return `Inspire could not ${action}: ${reason}.`;
  if (code === 404) return `Inspire could not ${action}: the service cannot find it.`;
  return `Inspire could not ${action}: the service answered with HTTP ${code || 'an error'}. Try again, and tell an App manager if it repeats.`;
}

function logApiBody(action, status, body) {
  console.error(`${action} failed (HTTP ${status}): ${String(body || '').slice(0, 1200)}`);
}

module.exports = { apiRefusalText, logApiBody, platformReasonOf };
