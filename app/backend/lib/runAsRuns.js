// REQ-409: run-as-me installs run as the installer, and only the App's service principal holds CAN_MANAGE_RUN on the installed jobs
// (installer/inspire_setup.py). So the calls that start, read or cancel an installed job's run, or touch an installed job, use the App's
// own token, and only once the job id is known to be one of the installed ids. Every other call keeps the signed-in person's token (REQ-113).
// A run id is never read with the App token before its job id is known: the job id comes from the person's own read of the run, else from
// Inspire's launch record (read with the person's token). A run whose job is not an installed job keeps the person's token.
const { RUN_AS_JOB_ENV, runAsPerson } = require('./inspireJobParams');

// The job ids the installer wrote into the App's environment, one per job type.
function installedJobIds(env = process.env) {
  return new Set(Object.values(RUN_AS_JOB_ENV).map((name) => String(env[name] || '').trim()).filter(Boolean));
}

function isInstalledJob(jobId, env = process.env) {
  const id = String(jobId ?? '').trim();
  return id !== '' && installedJobIds(env).has(id);
}

/**
 * dbFetch: (host, token, path, opts) -> Response-like. appToken: async () -> the App's service principal token, or null.
 * runAs: () -> boolean (defaults to the install's run-as setting). ledgerJobId(runId) -> the job id Inspire's launch record holds, or null
 * (read with the person's token by the caller).
 */
function createInstalledRuns({ dbFetch, appToken, runAs = runAsPerson, env = process.env }) {
  // The token that starts a run of an installed job (run-now). In run-as mode the App's own token is required: the person's token is refused.
  async function startToken(personToken) {
    if (!runAs()) return personToken;
    const token = await appToken();
    if (!token) {
      throw Object.assign(new Error('Inspire cannot start the installed job, because its App service principal has no token yet. Try again in a moment.'),
        { statusCode: 503 });
    }
    return token;
  }

  // The job id of a run, from the person's own read first and then from Inspire's launch record. Never from the App's token.
  async function jobIdOfRun(host, personToken, runId, ledgerJobId) {
    const resp = await dbFetch(host, personToken, `/api/2.1/jobs/runs/get?run_id=${encodeURIComponent(runId)}`).catch(() => null);
    if (resp && resp.ok) {
      const run = await resp.json().catch(() => null);
      if (run && run.job_id != null) return String(run.job_id);
    }
    if (typeof ledgerJobId === 'function') {
      const jobId = await Promise.resolve().then(() => ledgerJobId(runId)).catch(() => null);
      if (jobId != null && String(jobId).trim() !== '') return String(jobId).trim();
    }
    return '';
  }

  // The token for a read or cancel of one run: the App's only when the run's job is an installed job (run-as mode only).
  async function runToken(host, personToken, runId, ledgerJobId) {
    if (!runAs()) return personToken;
    if (!/^\d{1,19}$/.test(String(runId ?? ''))) return personToken;
    const jobId = await jobIdOfRun(host, personToken, runId, ledgerJobId);
    if (!isInstalledJob(jobId, env)) return personToken;
    return (await appToken()) || personToken;
  }

  // The token for a job-level call (cancel-all, job get, runs list) on a job id: the App's only when that job is an installed job.
  async function jobToken(personToken, jobId) {
    if (!runAs()) return personToken;
    if (!isInstalledJob(jobId, env)) return personToken;
    return (await appToken()) || personToken;
  }

  return { startToken, runToken, jobToken };
}

module.exports = { createInstalledRuns, installedJobIds, isInstalledJob };
