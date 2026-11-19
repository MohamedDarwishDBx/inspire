// REQ-414 part B: Approve and Reject on a pending row of the Work queue, in a browser at 1440x900. Fixture as in rowChoices.test.mjs:
// the same decision page and records, with the first two rows awaiting approval. Reject asks the reason in the row; Approve needs none.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DECIDE, ROWS, SUMMARY, TABLE, actBody, appInfo, lister, openApp, serveDist, tracked } from './harness.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const CLOCK = new Date('2026-10-27T09:30:00Z');
const AS_OF = String((CLOCK.getTime() - 5000) * 1000);
const PENDING = ROWS.map((r, i) => (i < 2 ? { ...r, approval_status: 'awaiting approval' } : r));

function routesFor(writes) {
  return tracked({
    records: lister(PENDING, { actions: true, changes: true, summary: SUMMARY, as_of_us: AS_OF }),
    'records/act': ({ route, json }) => {
      const body = actBody(route);
      writes.push(body);
      return json(200, { written: body.record_keys || [], conflicts: [], batch_id: `b${'0'.repeat(31)}1` });
    },
  }).routes;
}

async function openQueue(writes) {
  const opened = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { routes: routesFor(writes), clock: CLOCK,
    timezone: 'Asia/Dubai', hash: '#/n01_u05/work' });
  await opened.page.waitForFunction(() => document.querySelectorAll('.card--table tbody tr').length > 0 && document.querySelector('.list-tools'));
  return opened;
}

test('at 1440x900 Reject asks the reason in the row and writes it; Approve writes approved with no reason', async () => {
  const writes = [];
  const { page, seen, context } = await openQueue(writes);
  try {
    assert.equal(page.viewportSize().width, 1440);
    const row = page.locator('.card--table tbody tr').first();
    await row.locator('[data-row-approve]').waitFor();
    await row.locator('[data-row-reject]').click();
    const submit = row.locator('.row-ask button.btn--pri');
    assert.equal(await submit.isDisabled(), true, 'Reject stays off until a reason is typed');
    await row.locator('[data-row-reject-reason]').fill('outside policy');
    assert.equal(await submit.isDisabled(), false);
    await submit.click();
    await page.waitForTimeout(300);
    assert.equal(writes.length, 1, 'one click, one write');
    assert.deepEqual(writes[0].values, { approval_status: 'rejected', approval_note: 'outside policy' });

    const second = page.locator('.card--table tbody tr').nth(1);
    await second.locator('[data-row-approve]').click();
    await page.waitForTimeout(300);
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[1].values, { approval_status: 'approved' });
    assert.deepEqual(seen.errors, []);
  } finally {
    await context.close();
  }
});
