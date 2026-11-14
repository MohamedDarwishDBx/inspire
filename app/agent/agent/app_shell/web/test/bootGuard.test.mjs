import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// The App shell's boot guard (shared with the frontend, inlined into index.html at build time). One aborted app.js request is
// the same failure as a frontend module: React never mounts, so the guard must reload once, then show its message.
const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const GUARD_TEXT = 'Inspire could not finish loading because the network connection changed. Reload to try again.';
const ABORTED = 'net::ERR_CONNECTION_ABORTED';
let server;
let origin;
let browser;
const loads = [];

before(async () => {
  server = createServer(async (req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/') loads.push(path);
    try {
      const body = await readFile(join(DIST, path === '/' ? 'index.html' : path));
      res.writeHead(200, { 'content-type': TYPES[path.slice(path.lastIndexOf('.'))] || 'text/html' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('missing');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await new Promise((r) => server.close(r));
});

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
  await page.goto(`${origin}/`);
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
