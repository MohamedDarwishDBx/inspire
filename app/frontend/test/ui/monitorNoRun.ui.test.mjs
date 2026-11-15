import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

// FW1 D5: /#/monitor opened with no session id and no run id showed the newest completed session in the database. A Monitor with no
// run open says so, and the page never asks the App for "the latest session" (the App answers with whichever session it finds newest).
const MINUTE = 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

test('Monitor with no run open shows the no-run state and does not read or show the newest completed session', async () => {
  const calls = { session: [] };
  const mount = (app) => {
    app.get('/api/inspire/session', (req, res) => {
      calls.session.push({ ...req.query });
      res.json({ session: { session_id: '1794714407111445340', business_name: 'E2E Walk', create_at: ago(30 * MINUTE),
        processing_status: 'done', completed_percent: 100, completed_on: ago(MINUTE), last_updated: ago(MINUTE) } });
    });
    app.get('/api/inspire/steps', (_req, res) => res.json({ steps: [] }));
  };
  const ui = await openUi('monitor', {}, '&run=bare', { mount });
  try {
    const card = ui.page.locator('div.rounded-xl.p-5.mb-6').first();
    await card.waitFor({ timeout: 10000 });
    await card.getByText('No run open', { exact: true }).waitFor({ timeout: 10000 });
    assert.equal(await card.getByText('Completed', { exact: true }).count(), 0, 'the old completed run is not shown');
    assert.equal(await ui.page.getByText('E2E Walk', { exact: false }).count(), 0, 'the old run name is not shown');
    assert.deepEqual(calls.session.filter((q) => !q.session_id), [], 'no session read without a session id');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
