const { AsyncLocalStorage } = require('node:async_hooks');
const { plural } = require('./plural');
const { busyDelayMs, isTransientStatus } = require('./busyRetry');

const PAGE_SQL_DEADLINE_MS = 240000;
const READ_ONLY_SQL_RE = /^\s*(SELECT|WITH|SHOW|DESCRIBE|DESC|EXPLAIN)\b/i;
const WRITE_WORD_RE = /\b(INSERT|MERGE|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|COPY|OPTIMIZE|VACUUM)\b|\bREPLACE\b(?!\s*\()/i;

function isIdempotentSql(sql) {
  return READ_ONLY_SQL_RE.test(sql) && !WRITE_WORD_RE.test(sql);
}
const DELTA_WRITE_CONFLICT_RE =
  /DELTA_CONCURRENT_\w+|DELTA_(METADATA|PROTOCOL)_CHANGED|CONCURRENT_(APPEND|DELETE|TRANSACTION|WRITE)|Concurrent\w*Exception|(Metadata|Protocol)ChangedException/i;
const CONFLICT_WINDOW_MS = 60000;
const CONFLICT_BASE_DELAY_MS = 250;
const CONFLICT_MAX_DELAY_MS = 8000;

function conflictDelayCeiling(attempt) {
  return Math.min(CONFLICT_MAX_DELAY_MS, CONFLICT_BASE_DELAY_MS * 2 ** (attempt - 1));
}

function conflictAttempts() {
  let attempts = 1;
  let spent = 0;
  while (spent + 1.5 * conflictDelayCeiling(attempts) <= CONFLICT_WINDOW_MS) {
    spent += 1.5 * conflictDelayCeiling(attempts);
    attempts += 1;
  }
  return attempts;
}

const CONFLICT_ATTEMPTS = conflictAttempts();
const SLOW_WAREHOUSE_MESSAGE =
  `The SQL warehouse did not answer within ${PAGE_SQL_DEADLINE_MS / 60000} minutes, so Inspire stopped the query. ` +
  'The warehouse may be starting or waiting for compute. Try again in a minute.';

const requestDeadline = new AsyncLocalStorage();
const queryTagStore = new AsyncLocalStorage();
const QUERY_TAG_MAX = 128;

function sqlQueryTags(tags) {
  return Object.entries(tags || {})
    .map(([key, value]) => ({ key, value: String(value ?? '').split(/\s+/).filter(Boolean).join(' ').slice(0, QUERY_TAG_MAX) }))
    .filter((tag) => tag.value);
}

function runWithQueryTags(tags, fn) {
  return queryTagStore.run(sqlQueryTags(tags), fn);
}

function runWithRequestDeadline(fn, ms = PAGE_SQL_DEADLINE_MS, now = Date.now) {
  return requestDeadline.run({ deadline: now() + ms }, fn);
}

function readDeadline(sql) {
  const store = requestDeadline.getStore();
  if (!store || typeof sql !== 'string' || !READ_ONLY_SQL_RE.test(sql)) return null;
  return store.deadline;
}

function sqlDeadlineError(statementId) {
  return Object.assign(new Error(SLOW_WAREHOUSE_MESSAGE), { code: 'SQL_DEADLINE', statementId });
}

function sqlCancelledError(statementId) {
  return Object.assign(new Error('The query was cancelled, so Inspire stopped it.'), { code: 'SQL_CANCELLED', statementId });
}

// The API's error_code is a string enum (REST API errors page). Legacy endpoints send an integer, which is treated as absent.
function errorCodeOf(source) {
  let body = source;
  if (typeof source === 'string') {
    try { body = JSON.parse(source); } catch { return undefined; }
  }
  return body && typeof body.error_code === 'string' && body.error_code ? body.error_code : undefined;
}

function isDeltaWriteConflict(message) {
  return DELTA_WRITE_CONFLICT_RE.test(String(message || ''));
}

function createExecuteSql(dbFetch, { now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), random = Math.random } = {}) {
  async function cancelStatement(host, token, statementId) {
    try {
      const resp = await dbFetch(host, token, `/api/2.0/sql/statements/${statementId}/cancel`, { method: 'POST' });
      if (!resp.ok) console.warn(`   ⚠️ SQL cancel refused for ${statementId} (${resp.status})`);
    } catch (e) {
      console.warn(`   ⚠️ SQL cancel failed for ${statementId}: ${e.message}`);
    }
  }

  async function runOnce(host, token, warehouseId, sql, parameters, options) {
    console.log(`   🔶 SQL: ${sql.substring(0, 150)}...`);
    const deadline = readDeadline(sql);
    if (deadline !== null && now() >= deadline) throw sqlDeadlineError(null);
    const { rowLimit = null, byteLimit = null, waitTimeout = '50s', signal = null } = options || {};
    if (signal && signal.aborted) throw sqlCancelledError(null);

    const body = {
      warehouse_id: warehouseId,
      statement: sql,
      wait_timeout: waitTimeout,
      on_wait_timeout: 'CONTINUE',
      disposition: 'INLINE',
      format: 'JSON_ARRAY',
    };
    if (Array.isArray(parameters) && parameters.length) body.parameters = parameters;
    const queryTags = queryTagStore.getStore() || [];
    if (queryTags.length) body.query_tags = queryTags;
    if (Number.isInteger(rowLimit) && rowLimit > 0) body.row_limit = rowLimit;
    if (Number.isInteger(byteLimit) && byteLimit > 0) body.byte_limit = byteLimit;
    const submitResp = await dbFetch(host, token, '/api/2.0/sql/statements', {
      method: 'POST',
      body: JSON.stringify(body),
      idempotent: isIdempotentSql(sql),
    });
    if (!submitResp.ok) {
      const errText = await submitResp.text();
      console.error(`   ❌ SQL submit failed (${submitResp.status}): ${errText.substring(0, 200)}`);
      throw Object.assign(new Error(`SQL failed (${submitResp.status}): ${errText}`), { http_status: submitResp.status, error_code: errorCodeOf(errText) });
    }
    let result = await submitResp.json();
    console.log(`   📄 SQL state: ${result.status?.state}`);

    let pollCount = 0;
    while (result.status?.state === 'PENDING' || result.status?.state === 'RUNNING') {
      if (signal && signal.aborted) {
        await cancelStatement(host, token, result.statement_id);
        console.warn(`   ⏹️ SQL cancelled by the caller: ${result.statement_id}`);
        throw sqlCancelledError(result.statement_id);
      }
      if (deadline !== null && now() >= deadline) {
        await cancelStatement(host, token, result.statement_id);
        console.warn(`   ⏱️ SQL stopped at the page deadline: ${result.statement_id}`);
        throw sqlDeadlineError(result.statement_id);
      }
      pollCount++;
      await sleep(2000);
      const pollResp = await dbFetch(host, token, `/api/2.0/sql/statements/${result.statement_id}`);
      if (!pollResp.ok) throw new Error(`SQL polling failed`);
      result = await pollResp.json();
      if (pollCount % 5 === 0) console.log(`   ⏳ Polling (${pollCount})...`);
    }

    if (result.status?.state === 'FAILED') {
      const errMsg = result.status?.error?.message || 'SQL statement execution failed';
      console.warn(`   ⚠️ SQL failed: ${errMsg.substring(0, 300)}`);
      // The statement reports FAILED with HTTP 200: its error_code (status.error.error_code) and sql_state are the structured fields.
      throw Object.assign(new Error(errMsg), { error_code: errorCodeOf(result.status?.error), sql_state: result.status?.sql_state || undefined });
    }

    if (result.manifest?.total_chunk_count > 1 && result.manifest?.chunks) {
      let allData = result.result?.data_array || [];
      for (const chunk of result.manifest.chunks) {
        if (chunk.chunk_index === 0) continue;
        const chunkResp = await dbFetch(host, token, `/api/2.0/sql/statements/${result.statement_id}/result/chunks/${chunk.chunk_index}`);
        if (chunkResp.ok) {
          const chunkData = await chunkResp.json();
          if (chunkData.data_array) allData = allData.concat(chunkData.data_array);
        }
      }
      result.result = result.result || {};
      result.result.data_array = allData;
    }

    const rowCount = result.result?.data_array?.length ?? 0;
    console.log(`   ✅ SQL done: ${plural(rowCount, 'row')}`);
    return result;
  }

  return async function executeSql(host, token, warehouseId, sql, parameters = null, options = {}) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await runOnce(host, token, warehouseId, sql, parameters, options);
      } catch (err) {
        if (attempt >= CONFLICT_ATTEMPTS || !isDeltaWriteConflict(err.message)) throw err;
        const ceiling = conflictDelayCeiling(attempt);
        const wait = ceiling + Math.floor(random() * ceiling);
        console.warn(`   🔄 Delta write conflict with another Inspire run, SQL retry ${attempt}/${CONFLICT_ATTEMPTS - 1} in ${wait}ms`);
        await sleep(wait);
      }
    }
  };
}

// Documented error_code values (REST API errors page). A permanent code means the request itself is refused: a retry gives the same answer.
const PERMANENT_ERROR_CODES = new Set(['PERMISSION_DENIED', 'UNAUTHENTICATED', 'NOT_FOUND', 'ENDPOINT_NOT_FOUND', 'INVALID_PARAMETER_VALUE', 'ALREADY_EXISTS']);
// Documented as transient (TEMPORARILY_UNAVAILABLE, SERVICE_UNDER_MAINTENANCE, the workspace variant), or a busy or late answer to a read
// (RESOURCE_EXHAUSTED is the 429 class, DEADLINE_EXCEEDED a server timeout). lookupWithRetry only runs reads, so a retry is safe.
const TRANSIENT_ERROR_CODES = new Set(['TEMPORARILY_UNAVAILABLE', 'WORKSPACE_TEMPORARILY_UNAVAILABLE', 'SERVICE_UNDER_MAINTENANCE', 'RESOURCE_EXHAUSTED', 'DEADLINE_EXCEEDED']);
// The documented warehouse states (GET /api/2.0/sql/warehouses/{id}) are STARTING, RUNNING, STOPPING, STOPPED, DELETING, DELETED. The
// statement docs name no code for a warehouse that is starting or stopped (FAILED carries only the text), so this text is the fallback.
const WAREHOUSE_NOT_READY_RE = /warehouse[^.;]*\b(starting|stopped|not (yet )?running)\b|\b(starting|stopped)\b[^.;]*warehouse/i;

/** True when a failed read can succeed on a retry: a busy or down workspace, a warehouse that is starting or stopped, a statement that
 *  timed out, or a dropped network. A denial, a missing object or a bad statement is not transient. Structured fields decide first
 *  (error_code, then the HTTP status of a rejected request); the message text is used only when they give no verdict. */
function isTransientSqlFailure(err) {
  if (!err) return false;
  if (err.code === 'SQL_DEADLINE' || err.timedOut) return true;
  if (PERMANENT_ERROR_CODES.has(err.error_code)) return false;
  if (TRANSIENT_ERROR_CODES.has(err.error_code)) return true;
  if (Number.isInteger(err.http_status)) return isTransientStatus(err.http_status);
  const message = String(err.message || err || '');
  const submitted = /^SQL failed \((\d{3})\)/.exec(message);
  if (submitted) return isTransientStatus(submitted[1]);
  if (WAREHOUSE_NOT_READY_RE.test(message)) return true;
  return /^Cannot reach (the )?Databricks/.test(message);
}

// The errors page says a RESOURCE_EXHAUSTED (quota) answer is not retried automatically: it can take hours to clear. It is still busy.
function retriesAutomatically(err) {
  return !(err && err.error_code === 'RESOURCE_EXHAUSTED');
}

/** Runs one read that feeds a verdict. A transient failure is retried once after the busy delay, except a quota answer (see
 *  retriesAutomatically). Returns { value } on success, or { error, transient } where transient says whether a later try can change
 *  the answer (the person can then check again). */
async function lookupWithRetry(run, { sleep = (ms) => new Promise((done) => setTimeout(done, ms)) } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return { value: await run() };
    } catch (error) {
      const transient = isTransientSqlFailure(error);
      if (!transient || attempt >= 2 || !retriesAutomatically(error)) return { error, transient };
      await sleep(busyDelayMs(attempt));
    }
  }
}

module.exports = {
  createExecuteSql,
  isTransientSqlFailure,
  lookupWithRetry,
  isIdempotentSql,
  sqlQueryTags,
  runWithQueryTags,
  sqlCancelledError,
  isDeltaWriteConflict,
  CONFLICT_ATTEMPTS,
  CONFLICT_WINDOW_MS,
  runWithRequestDeadline,
  readDeadline,
  PAGE_SQL_DEADLINE_MS,
  SLOW_WAREHOUSE_MESSAGE,
};
