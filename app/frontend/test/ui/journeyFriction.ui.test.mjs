import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, goToStep, openUi } from './uiSupport.mjs';

// REQ-322, REQ-325: the delivery step starts with the Agentic App ticked and the Genie Agent not ticked, and a real mouse click
// anywhere on a delivery card ticks or unticks that card, at 1440x900 and 1280x800.

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const DATED = [{ column_name: 'order_id', data_type: 'STRING', ordinal_position: 1 }, { column_name: 'order_date', data_type: 'DATE', ordinal_position: 2 }];
const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 1280, height: 800 }];

async function toDelivery(page) {
  await goToStep(page, 'Data');
  await goToStep(page, 'What to build');
}

const card = (page, id) => page.locator(`[data-output="${id}"]`);
const tick = (page, id) => card(page, id).getByRole('checkbox').first();

test('the Agentic App starts ticked and the Genie Agent does not, so a person who picks only the App gets no Genie Agent (REQ-322)', async () => {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' }, columns: DATED });
  const { page } = ui;
  try {
    await toDelivery(page);
    assert.deepEqual(
      [await tick(page, 'app').isChecked(), await tick(page, 'genie_space').isChecked(), await tick(page, 'dashboard').isChecked()],
      [true, false, false],
      'only the Agentic App is ticked by default',
    );
  } finally {
    await ui.close();
  }
});

for (const viewport of VIEWPORTS) {
  test(`a real mouse click on any part of a delivery card ticks it at ${viewport.width}x${viewport.height} (REQ-325)`, async () => {
    const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' }, columns: DATED });
    const { page } = ui;
    try {
      await page.setViewportSize(viewport);
      await toDelivery(page);
      // The Agentic App is ticked by default, so each click below must untick it, then tick it again.
      const description = card(page, 'app').getByText('A Databricks App with the decision list');
      await description.click();
      assert.equal(await tick(page, 'app').isChecked(), false, 'a real click on the description text unticks the Agentic App');
      await description.click();
      assert.equal(await tick(page, 'app').isChecked(), true, 'a second real click on the description text ticks it again');
      const box = await card(page, 'app').boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      assert.equal(await tick(page, 'app').isChecked(), false, 'a real click on the centre of the card unticks it');
      // The card changes height when it unticks, so the corner is measured again after the centre click.
      const after = await card(page, 'app').boundingBox();
      await page.mouse.click(after.x + after.width - 8, after.y + 8);
      assert.equal(await tick(page, 'app').isChecked(), true, 'a real click on the card corner ticks it again');
      for (const id of ['dashboard', 'genie_space', 'alert']) {
        const cardBox = await card(page, id).boundingBox();
        await page.mouse.click(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
        assert.equal(await tick(page, id).isChecked(), true, `a real click on the centre of the ${id} card ticks it`);
      }
    } finally {
      await ui.close();
    }
  });
}
