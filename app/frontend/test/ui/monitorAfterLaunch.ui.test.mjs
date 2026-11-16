// REQ-188: right after the person's own launch, a run the launch record does not show yet is Starting, not "Cannot read this run".
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, until } from './uiSupport.mjs';

test.after(closeBrowser);

const RECORDED_REFUSAL = {
  error: 'Inspire shows only runs it launched and recorded in its own database, and it has no record of run 777, so it does not read it.',
  policy: { route: 'GET /api/run/:runId', rule: 'recorded', needs: 'a run Inspire launched and recorded in its own database' },
};

test('(1) Monitor right after a launch: the run answers 403 recorded and the session is not there yet, so it shows Starting with no access refusal; then progress once the session appears (fail-pre: showed Cannot read this run)', async () => {
  const reads = { run: 0, session: 0, sessionUp: false };
  const mount = (app) => {
    app.get('/api/inspire/session', (_req, res) => {
      reads.session += 1;
      res.json({ session: reads.sessionUp ? { session_id: '42', business_name: 'Acme Retail', create_at: new Date().toISOString(), completed_percent: 6, completed_on: null, last_updated: new Date().toISOString(), processing_status: 'running' } : null });
    });
    app.get('/api/inspire/steps', (_req, res) => res.json({ steps: [] }));
    app.post('/api/inspire/ack', (_req, res) => res.json({ success: true }));
    app.get('/api/run/777', (_req, res) => {
      reads.run += 1;
      res.status(403).json(RECORDED_REFUSAL);
    });
  };
  const ui = await openUi('monitor', {}, '', { mount });
  const { page } = ui;
  try {
    const card = page.locator('[data-testid="monitor-status"]');
    await card.getByText('Starting', { exact: true }).waitFor({ timeout: 15000 });
    await page.waitForTimeout(2500);
    assert.equal(await page.getByText('Cannot read this run', { exact: true }).count(), 0, 'no access refusal while the record is pending');
    assert.equal(await page.locator('[data-testid="monitor-failure-choices"]').count(), 0, 'no ask-for-access choices while pending');
    assert.ok(reads.run >= 2, 'Monitor keeps checking the run during the wait');

    reads.sessionUp = true;
    await card.getByText('Running', { exact: true }).waitFor({ timeout: 15000 });
    await until(async () => (await card.innerText()).includes('6% complete'), '6% complete', 15000);
    assert.equal(await page.getByText('Cannot read this run', { exact: true }).count(), 0);
    assert.ok(reads.session >= 2);
  } finally {
    await ui.close();
  }
});
