import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, stubMoney } from './uiSupport.mjs';

test.after(closeBrowser);

// REQ-206 (class sweep): the Start-MVP overlay and the use-case details drawer close on Escape, keep their header and Close in
// view while the body scrolls, and keep Tab inside while open. Escape closes only the top dialog.
const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const stubPreview = (page) => stubMoney('value-preview', () => ({ rows: [{ stake: 1, currency: 'USD' }] }), [])(page);
const SIZES = [[1280, 800], [1440, 900], [1024, 700]];
const overlay = (page) => page.locator('[data-implement-overlay]');
const inView = (box, height) => Boolean(box && box.y >= 0 && box.y + box.height <= height);

for (const [width, height] of SIZES) {
  test(`the Start-MVP overlay at ${width}x${height}: header and Close stay in view, the body scrolls, Escape closes it`, async () => {
    const ui = await openUi('wizard', ME, '', { init: stubPreview });
    const { page } = ui;
    try {
      await page.setViewportSize({ width, height });
      await overlay(page).waitFor({ timeout: 15000 });
      const close = overlay(page).getByRole('button', { name: 'Close', exact: true });
      assert.ok(inView(await close.boundingBox(), height), `Close is inside the ${width}x${height} viewport`);
      assert.ok(inView(await page.locator('[data-wizard-header]').boundingBox(), height), 'the header stays in the viewport');
      const panelFits = await page.evaluate(() => {
        const p = document.querySelector('[data-implement-overlay] [role="dialog"]');
        return p.getBoundingClientRect().height <= window.innerHeight;
      });
      assert.equal(panelFits, true, 'the overlay fits the viewport');
      const scrolls = await page.evaluate(() => [...document.querySelectorAll('[data-implement-overlay] [role="dialog"] div')]
        .some((el) => getComputedStyle(el).overflowY === 'auto'));
      assert.equal(scrolls, true, 'a body region scrolls inside the overlay');
      await page.keyboard.press('Escape');
      await overlay(page).waitFor({ state: 'detached', timeout: 5000 }).catch(() => null);
      assert.equal(await overlay(page).count(), 0, 'Escape closes the Start-MVP overlay');
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  });
}

test('the use-case details drawer: Escape closes only the drawer, the overlay stays, and Tab stays inside the drawer', async () => {
  const ui = await openUi('wizard', ME, '', { init: stubPreview });
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await overlay(page).waitFor({ timeout: 15000 });
    await page.locator('[data-use-case-details-open]').first().click();
    const drawer = page.locator('[data-use-case-drawer]');
    await drawer.waitFor({ timeout: 5000 });
    const inDrawer = () => page.evaluate(() => Boolean(document.activeElement?.closest('[data-use-case-drawer] [role="dialog"]')));
    for (let i = 0; i < 20; i += 1) {
      await page.keyboard.press('Tab');
      assert.equal(await inDrawer(), true, `Tab ${i + 1} keeps focus in the use-case drawer`);
    }
    await page.keyboard.press('Escape');
    await drawer.waitFor({ state: 'detached', timeout: 5000 }).catch(() => null);
    assert.equal(await drawer.count(), 0, 'Escape closes the use-case drawer');
    assert.equal(await overlay(page).count(), 1, 'the overlay stays open after the drawer closes');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
