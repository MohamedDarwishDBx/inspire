import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serveDist } from './harness.mjs';

// The guard runs under the production policy: pageCsp from the backend, the same policy a hosted App shell is served with.
const require = createRequire(import.meta.url);
const { BOOT_GUARD_SCRIPT_HASH } = require('../../../../../backend/lib/bootGuardCsp.js');
const { pageCsp } = require('../../../../../backend/lib/hostedRun.js');
const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PREFIX = '/run/n01-u05-guard/';
const GUARD_TEXT = 'Inspire could not finish loading because the network connection changed. Reload to try again.';
const ABORTED = 'net::ERR_CONNECTION_ABORTED';

let served;
let browser;
const loads = [];

before(async () => {
  served = await serveDist({ prefix: PREFIX, headers: (origin) => ({ 'content-security-policy': pageCsp(origin, PREFIX) }) });
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); served?.close(); });

test('the built index.html inline guard hashes to the backend constant, and the production policy allows exactly that script', () => {
  const html = readFileSync(join(DIST, 'index.html'), 'utf8');
  const inline = /<script>\n([\s\S]*?)<\/script>/.exec(html);
  assert.ok(inline, 'the guard is inline in the built index.html');
  assert.equal(`sha256-${createHash('sha256').update(`\n${inline[1]}`).digest('base64')}`, BOOT_GUARD_SCRIPT_HASH);
  assert.ok(pageCsp('https://workspace.example.com', PREFIX).includes(`'${BOOT_GUARD_SCRIPT_HASH}'`));
});

async function openShell(abortApp) {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => {
    const url = m.location().url;
    if (m.type() === 'error' && !url.endsWith('/favicon.ico') && !url.includes('/api/')) errors.push(m.text());
  });
  let aborted = 0;
  await page.route(`**${PREFIX}assets/app.js*`, (route) => {
    aborted += 1;
    return abortApp(aborted) ? route.abort('connectionaborted') : route.continue();
  });
  loads.length = 0;
  page.on('request', (r) => { if (r.isNavigationRequest() && r.url() === served.base) loads.push(r.url()); });
  await page.goto(served.base);
  return { page, errors, aborted: () => aborted, close: () => page.context().close() };
}

test('under the production policy, an aborted app.js still reloads once by the inline guard and renders', async () => {
  const shell = await openShell((n) => n === 1);
  try {
    await shell.page.waitForFunction(() => document.getElementById('root')?.children.length > 0 && !document.querySelector('[data-boot-guard]'), null, { timeout: 30000 });
    assert.equal(loads.length, 2, 'one automatic reload');
    assert.ok(shell.aborted() >= 2, 'app.js was requested again after the abort');
    assert.deepEqual(shell.errors.filter((e) => !e.includes(ABORTED)), [], 'the policy blocks nothing the guard needs');
  } finally {
    await shell.close();
  }
});

test('under the production policy, every app.js aborted shows the message and Reload, after one reload and no loop', async () => {
  const shell = await openShell(() => true);
  try {
    await shell.page.getByText(GUARD_TEXT).waitFor({ timeout: 30000 });
    await new Promise((r) => setTimeout(r, 3000));
    assert.equal(loads.length, 2, 'the first load and one automatic reload, then the message stays');
    assert.deepEqual(shell.errors.filter((e) => !e.includes(ABORTED)), []);
  } finally {
    await shell.close();
  }
});
