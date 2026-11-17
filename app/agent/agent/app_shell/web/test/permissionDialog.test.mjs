// REQ-311: an MVP App that cannot read its data opens the Permission Required dialog: one instruction line, a block of only the GRANT
// statements, Copy, and Request access only when the workspace has a destination for them. The request is sent as the viewer.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, openApp, serveDist, until } from './harness.mjs';

const TABLE = 'main.pricing.items';
const GRANTS = ['GRANT USE SCHEMA ON SCHEMA `main`.`pricing` TO `viewer@example.com`', 'GRANT SELECT ON TABLE `main`.`pricing`.`items` TO `viewer@example.com`'];
const FOUND = { tables: [{ table: TABLE, owner: 'data-eng', grants: GRANTS, you_can_grant: false }], can_grant: true, you_can_grant: false,
  sql: GRANTS.map((g) => `${g};`).join('\n'), seen: 'c'.repeat(64) };
const WAITING = { state: 'waiting_for_access', message: 'This App is waiting for access to its data.', tables: [TABLE], owners: ['data-eng'], detail: `No access to ${TABLE}` };
// REQ-313: the one instruction line sits under Advanced; Request access is the primary action (REQ-300 exactly one instruction line).
const COPY_LINE = 'Copy the SQL below and send it to your Databricks admin.';
const OFFER = { offered: true, destinations: ['owner@example.com'], reason: '' };

let served;
let browser;

before(async () => {
  served = await serveDist();
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  served?.close();
});

// The page is waiting: its load answers the waiting state, and the access routes answer what the test sets.
function waitingRoutes({ check = { offered: false, destinations: [], reason: 'no one has set up where access requests for these go yet' }, send } = {}) {
  const state = { checks: 0, sends: [] };
  const routes = {
    page: ({ json }) => json(200, WAITING),
    access: ({ json }) => json(200, FOUND),
    'access-request/check': ({ json }) => { state.checks += 1; return json(200, check); },
    'access-request': ({ route, json }) => {
      state.sends.push(route.request().postDataJSON?.() ?? null);
      return json(200, send || { sent: false, destinations: [], reason: 'no destination' });
    },
  };
  return { state, routes };
}

test('a waiting App opens the Permission Required dialog: one instruction line, only the GRANT statements, and Copy', async () => {
  const { routes } = waitingRoutes();
  const { page, context, seen } = await openApp(browser, served.base, appInfo({ unread: { [TABLE]: GRANTS }, unread_owners: { [TABLE]: 'data-eng' } }), { routes, ready: '[data-permission-dialog]' });
  try {
    const dialog = page.locator('[data-permission-dialog]');
    await dialog.waitFor({ timeout: 15000 });
    assert.equal(await dialog.getByText(COPY_LINE, { exact: true }).count(), 1, 'one instruction line');
    const block = (await dialog.locator('[data-permission-statements]').textContent()).trim();
    assert.equal(block, GRANTS.map((g) => `${g};`).join('\n'), 'the block holds the GRANT statements, each ending with a semicolon, and nothing else');
    assert.equal(await dialog.getByRole('button', { name: 'Copy', exact: true }).count(), 1);
    assert.equal(await dialog.getByRole('button', { name: 'Request access' }).count(), 1, 'REQ-406: Request access shows without a destination too');
    await until(() => dialog.locator('details[data-permission-advanced]').evaluate((el) => el.open), 10000);
    assert.equal(await dialog.locator('details[data-permission-advanced]').evaluate((el) => el.open), true, 'no destination: Advanced opens by default');
    assert.deepEqual(seen.errors, []);
  } finally {
    await context.close();
  }
});

test('Request access shows only when the workspace has a destination, and sends the viewer\'s grants as the person', async () => {
  const { state, routes } = waitingRoutes({ check: OFFER, send: { sent: true, destinations: ['owner@example.com'], reason: '' } });
  const { page, context } = await openApp(browser, served.base, appInfo({ unread: { [TABLE]: GRANTS }, unread_owners: { [TABLE]: 'data-eng' } }), { routes, ready: '[data-permission-dialog]' });
  try {
    const dialog = page.locator('[data-permission-dialog]');
    const button = dialog.getByRole('button', { name: 'Request access' });
    await button.waitFor({ timeout: 15000 });
    assert.equal(await dialog.locator('details[data-permission-advanced]').evaluate((el) => el.open), false, 'a destination: the SQL stays under the closed Advanced section');
    await button.click();
    const result = dialog.locator('[data-access-request-result]');
    await result.waitFor({ timeout: 15000 });
    assert.equal((await result.textContent()).trim(), 'Request sent to owner@example.com');
    await until(() => state.sends.length === 1, 5000);
    assert.equal(state.checks >= 1, true);
    assert.equal(await page.locator('[data-permission-dialog]').count(), 1, 'one dialog, not a second one');
  } finally {
    await context.close();
  }
});

test('a refused request never shows the raw workspace error in the same dialog (REQ-406)', async () => {
  const { routes } = waitingRoutes({ check: OFFER, send: { sent: false, destinations: [], reason: 'PERMISSION_DENIED: you cannot request this securable' } });
  const { page, context } = await openApp(browser, served.base, appInfo({ unread: { [TABLE]: GRANTS }, unread_owners: { [TABLE]: 'data-eng' } }), { routes, ready: '[data-permission-dialog]' });
  try {
    const dialog = page.locator('[data-permission-dialog]');
    await dialog.getByRole('button', { name: 'Request access' }).click();
    const result = dialog.locator('[data-access-request-result]');
    await result.waitFor({ timeout: 15000 });
    // REQ-406: a refused send never shows the raw error; with no link in the check, the dialog names the SQL under Advanced instead.
    assert.equal((await result.textContent()).trim(), 'Copy the SQL under Advanced to request this access.');
  } finally {
    await context.close();
  }
});

// REQ-406 (App shell): with no destination, Request access opens the Databricks request form for the object in a new tab, and the dialog
// keeps one plain line (never a raw error).
test('REQ-406: with no destination, Request access opens the Catalog Explorer page of the table in a new tab', async () => {
  const link = { type: 'SCHEMA', full_name: 'main.pricing', url: 'https://workspace.example.com/explore/data/main/pricing' };
  const { routes } = waitingRoutes({ check: { offered: false, destinations: [], reason: 'none', links: [link] } });
  const { page, context } = await openApp(browser, served.base, appInfo({ unread: { [TABLE]: GRANTS }, unread_owners: { [TABLE]: 'data-eng' } }), { routes, ready: '[data-permission-dialog]' });
  try {
    const dialog = page.locator('[data-permission-dialog]');
    await dialog.waitFor({ timeout: 15000 });
    await page.evaluate(() => { window.__opened = []; window.open = (url) => { window.__opened.push(String(url)); return { opener: null, close() {}, set location(v) { window.__opened.push(String(v)); } }; }; });
    await dialog.getByRole('button', { name: 'Request access' }).click();
    await dialog.locator('[data-access-request-result]').waitFor({ timeout: 15000 });
    assert.deepEqual(await page.evaluate(() => window.__opened), ['about:blank', link.url]);
    assert.equal((await dialog.locator('[data-access-request-result]').textContent()).trim(), 'Opened the access request form for main.pricing in a new tab. Send the request there.');
  } finally {
    await context.close();
  }
});
