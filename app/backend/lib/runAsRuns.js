// REQ-409: run-as-me installs run as the installer, and only the App's service principal holds CAN_MANAGE_RUN on the installed jobs
// (installer/inspire_setup.py). So the calls that start, read or cancel an installed job's run use the App's own token, and only for a run
// whose job is one of those installed jobs. Every other call keeps the signed-in person's token (REQ-113). Nothing else uses this token.
const { RUN_AS_JOB_ENV, runAsPerson } = require('./inspireJobParams');

// The job ids the installer wrote into the App's environment, one per job type.
function installedJobIds(env = process.env) {
  return new Set(Object.values(RUN_AS_JOB_ENV).map((name) => String(env[name] || '').trim()).filter(Boolean));
}

function isInstalledRun(run, env = process.env) {
  return Boolean(run) && installedJobIds(env).has(String(run.job_id ?? '').trim());
}

/**
 * dbFetch: (host, token, path, opts) -> Response-like. appToken: async () -> the App's service principal token, or null.
 * runAs: () -> boolean (defaults to the install's run-as setting).
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

  // The token for a read or cancel of one run. In run-as mode the App's token is used only when the run belongs to an installed job.
  async function runToken(host, personToken, runId) {
    if (!runAs()) return personToken;
    const token = await appToken();
    if (!token || !/^\d{1,19}$/.test(String(runId ?? ''))) return personToken;
    const resp = await dbFetch(host, token, `/api/2.1/jobs/runs/get?run_id=${encodeURIComponent(runId)}`).catch(() => null);
    if (!resp || !resp.ok) return personToken;
    const run = await resp.json().catch(() => null);
    return isInstalledRun(run, env) ? token : personToken;
  }

  return { startToken, runToken };
}

module.exports = { createInstalledRuns, installedJobIds, isInstalledRun };
