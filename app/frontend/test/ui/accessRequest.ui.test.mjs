// REQ-311: the Permission Required dialog offers Request access only when the workspace has a destination for the grants, sends the request
// as the person, and falls back to the copied text when no destination is set or the request is refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';

test.after(closeBrowser);

const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const STATE = { catalogs: ['main'], schemas: { main: ['s'] }, tables: { 'main.s': ['orders'] } };
const PERSON = 'signed-in@example.com';
const STATEMENTS = [
  `GRANT USE CATALOG ON CATALOG \`main\` TO \`${PERSON}\``,
  `GRANT USE SCHEMA ON SCHEMA \`main\`.\`s\` TO \`${PERSON}\``,
  `GRANT SELECT ON TABLE \`main\`.\`s\`.\`orders\` TO \`${PERSON}\``,
];
const PERMISSION = { statements: STATEMENTS, principal: PERSON, why: 'Launch reads main.s.orders with your own access, and you cannot read it yet.' };
const COPY_LINE = 'Copy the text below and pass it on to your Databricks admin.';

async function openDialog(overrides) {
  const ui = await openUi('launch', { ...STATE, checkPermissions: [PERMISSION], ...overrides });
  const { page } = ui;
  await page.getByPlaceholder(BUSINESS).fill('Acme');
  await page.locator('button[title="main"]').click();
  await page.locator('button[title="s"]').click();
  await page.locator('button[title="orders"]').click();
  await idle(page);
  await until(async () => !(await page.getByRole('button', { name: 'Get Started' }).isDisabled()), 'Get Started opens');
  await page.getByRole('button', { name: 'Get Started' }).click();
  const dialog = page.locator('[data-permission-dialog=""]');
  await dialog.waitFor({ timeout: 15000 });
  return { ui, page, dialog };
}

test('when a destination is set, Request access sends the grants and says where the request went', async () => {
  const { ui, page, dialog } = await openDialog({
    accessCheck: { offered: true, destinations: ['owner@example.com'], reason: '' },
    accessSend: { sent: true, destinations: ['owner@example.com'], reason: '' },
  });
  const button = dialog.getByRole('button', { name: 'Request access' });
  await button.waitFor({ timeout: 15000 });
  await button.click();
  const result = dialog.locator('[data-access-request-result=""]');
  await result.waitFor({ timeout: 15000 });
  assert.equal((await result.textContent()).trim(), 'Request sent to owner@example.com');
  assert.deepEqual(ui.made.state.accessSent, STATEMENTS, 'the dialog sends its own grants');
  assert.equal(await dialog.getByRole('button', { name: 'Copy' }).count(), 1, 'the copy text stays available beside the request');
  assert.ok(page);
});

test('when no destination is set, there is no Request access button and the dialog keeps the copy text', async () => {
  const { page, dialog } = await openDialog({});
  await dialog.getByRole('button', { name: 'Copy' }).waitFor({ timeout: 15000 });
  await idle(page);
  assert.equal(await dialog.getByRole('button', { name: 'Request access' }).count(), 0, 'no button without a destination');
  assert.equal(await dialog.getByText(COPY_LINE).count(), 1, 'the copy-paste line stays');
  assert.equal(await dialog.locator('[data-access-request-result=""]').count(), 0);
});

test('a refused request is shown as its plain reason, and nothing opens over the dialog', async () => {
  const { ui, dialog } = await openDialog({
    accessCheck: { offered: true, destinations: ['owner@example.com'], reason: '' },
    accessSend: { sent: false, destinations: [], reason: 'PERMISSION_DENIED: you cannot request this securable' },
  });
  await dialog.getByRole('button', { name: 'Request access' }).click();
  const result = dialog.locator('[data-access-request-result=""]');
  await result.waitFor({ timeout: 15000 });
  assert.equal((await result.textContent()).trim(), 'Request not sent: PERMISSION_DENIED: you cannot request this securable');
  assert.equal(await ui.page.locator('[data-permission-dialog=""]').count(), 1, 'one dialog, not a second one');
});
