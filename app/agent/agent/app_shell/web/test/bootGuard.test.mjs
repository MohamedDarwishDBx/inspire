import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serveDist } from './harness.mjs';

// The App shell's boot guard (shared with the frontend, a same-origin asset in the build). One aborted app.js request is
// the same failure as a frontend module: React never mounts, so the guard must reload once, then show its message.
const GUARD_TEXT = 'Inspire could not finish loading because the network connection changed. Reload to try again.';
const ABORTED = 'net::ERR_CONNECTION_ABORTED';
let served;
let browser;
const loads = [];

before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

async function openShell(abortApp) {
  const page = await browser.newPage();
  const errors = [];
  // This harness serves no favicon and no API, so the browser's 404s for those are not boot errors.
  page.on('console', (m) => {
    const url = m.location().url;
    if (m.type() === 'error' && !url.endsWith('/favicon.ico') && !url.includes('/api/')) errors.push(m.text());
  });
  let aborted = 0;
  await page.route('**/assets/app.js*', (route) => {
    aborted += 1;
    return abortApp(aborted) ? route.abort('connectionaborted') : route.continue();
  });
  loads.length = 0;
  page.on('request', (r) => { if (r.isNavigationRequest() && r.url() === served.base) loads.push(r.url()); });
  await page.goto(served.base);
  return { page, errors, aborted: () => aborted, close: () => page.context().close() };
}

test('one app.js request aborted on first load: the shell reloads once by itself and renders', async () => {
  const shell = await openShell((n) => n === 1);
  try {
    await shell.page.waitForFunction(() => document.getElementById('root')?.children.length > 0 && !document.querySelector('[data-boot-guard]'), null, { timeout: 30000 });
    assert.equal(loads.length, 2, 'one automatic reload, no more');
    assert.ok(shell.aborted() >= 2, 'the entry was requested again after the abort');
    assert.deepEqual(shell.errors.filter((e) => !e.includes(ABORTED)), []);
  } finally {
    await shell.close();
  }
});

test('every app.js request aborted: the plain message and a Reload button show, after one automatic reload and no loop', async () => {
  const shell = await openShell(() => true);
  try {
    await shell.page.getByText(GUARD_TEXT).waitFor({ timeout: 30000 });
    assert.equal(await shell.page.getByRole('button', { name: 'Reload', exact: true }).count(), 1);
    await new Promise((r) => setTimeout(r, 3000));
    assert.equal(loads.length, 2, 'the first load and one automatic reload, then the message stays');
    assert.deepEqual(shell.errors.filter((e) => !e.includes(ABORTED)), []);
  } finally {
    await shell.close();
  }
});
