const BUSY_ATTEMPTS = 4;
const BUSY_BASE_MS = 2000;
const BUSY_MAX_MS = 30000;

function busyDelayMs(attempt, retryAfter = '', random = Math.random) {
  const asked = Number(String(retryAfter == null ? '' : retryAfter).trim());
  if (String(retryAfter == null ? '' : retryAfter).trim() && Number.isFinite(asked) && asked >= 0) return Math.min(asked * 1000, BUSY_MAX_MS);
  const wait = Math.min(BUSY_BASE_MS * 2 ** Math.max(attempt - 1, 0), BUSY_MAX_MS);
  return Math.min(wait + random() * wait * 0.25, BUSY_MAX_MS);
}

// A status that says the workspace is busy or down for a moment (429, or any 5xx): the same call can succeed on a retry.
function isTransientStatus(status) {
  const code = Number(status);
  return code === 429 || (code >= 500 && code <= 599);
}

function isBusy(method, status) {
  return status === 429 || (status === 503 && String(method || 'GET').toUpperCase() === 'GET');
}

async function withBusyRetry(fetchOnce, { method = 'GET', signal = null, sleep = (ms) => new Promise((done) => setTimeout(done, ms)), attempts = BUSY_ATTEMPTS, retryNetwork = false } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    let resp;
    try {
      resp = await fetchOnce();
    } catch (err) {
      if (!retryNetwork || attempt >= attempts || (signal && signal.aborted)) throw err;
      const wait = busyDelayMs(attempt);
      console.warn(`workspace did not answer (${err.message}); asking again in ${Math.round(wait)} ms (attempt ${attempt + 1}/${attempts})`);
      await sleep(wait);
      continue;
    }
    if (!isBusy(method, resp.status) || attempt >= attempts || (signal && signal.aborted)) return resp;
    const wait = busyDelayMs(attempt, resp.headers && resp.headers.get ? resp.headers.get('retry-after') : '');
    console.warn(`workspace busy (HTTP ${resp.status}); asking again in ${Math.round(wait)} ms (attempt ${attempt + 1}/${attempts})`);
    await sleep(wait);
  }
}

module.exports = { BUSY_ATTEMPTS, BUSY_BASE_MS, BUSY_MAX_MS, busyDelayMs, isBusy, isTransientStatus, withBusyRetry };
