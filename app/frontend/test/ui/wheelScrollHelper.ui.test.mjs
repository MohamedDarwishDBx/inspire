import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import * as fixed from './wheelScroll.mjs';
import * as baseline from './wheelScrollBaseline.fixture.mjs';

// The helper's own proof. A page where the region's content is late and where a layout shift moves the region away
// from the pointer after the first region scroll (the failure seen in the Monitor gate: the page scrolls and carries the
// region out of reach). The frozen baseline must fail it; the fixed helper must pass; regions that truly cannot scroll
// must still fail under the fixed helper.

let browser;
test.after(async () => { await browser?.close(); });

const ROWS = (n) => Array.from({ length: n }, (_, i) => `<div data-row="${i}" style="height:40px">row ${i}</div>`).join('');

// 300 px spacer above the region. The first scroll of the region shrinks the spacer to 0, which lifts the region 300 px
// out from under the pointer while the page still has room to scroll.
const shiftPage = (rows, regionCss = 'overflow-y:auto') => `<!doctype html><html><body style="margin:0;height:3000px">
<div id="spacer" style="height:300px"></div>
<div style="padding:0 20px"><div id="region" style="max-height:480px;width:300px;${regionCss}">${ROWS(rows)}</div></div>
<script>
  const region = document.getElementById('region');
  region.addEventListener('scroll', () => { document.getElementById('spacer').style.height = '0px'; }, { once: true });
</script></body></html>`;

// Rows arrive 1 s after load, the way a long Monitor list renders late under load.
const lateRowsPage = `<!doctype html><html><body style="margin:0;height:3000px">
<div style="padding:20px"><div id="region" style="max-height:480px;overflow-y:auto;width:300px">${ROWS(3)}</div></div>
<script>
  setTimeout(() => { document.getElementById('region').insertAdjacentHTML('beforeend', ${JSON.stringify(ROWS(30))}); }, 1000);
</script></body></html>`;

async function drive(helper, html) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.setContent(html);
    await helper.wheelToEnd(page, page.locator('#region'), page.locator('#region > [data-row]').last(), 'helper proof');
  } finally {
    await page.close();
  }
}

test.before(async () => { browser = await chromium.launch(); });

test('the frozen baseline fails when the layout moves the region away from the pointer after its first scroll', async () => {
  await assert.rejects(drive(baseline, shiftPage(30)), /helper proof/);
});

test('the fixed helper passes when the layout moves the region away from the pointer after its first scroll', async () => {
  await drive(fixed, shiftPage(30));
});

test('the frozen baseline fails when the region gets its rows late', async () => {
  await assert.rejects(drive(baseline, lateRowsPage), /helper proof/);
});

test('the fixed helper waits for late rows and then passes', async () => {
  await drive(fixed, lateRowsPage);
});

test('must-exclude: a region that never overflows still fails under the fixed helper', async () => {
  await assert.rejects(drive(fixed, shiftPage(3)), /does not overflow/);
});

test('must-exclude: a region that cannot scroll (overflow hidden) still fails under the fixed helper', async () => {
  await assert.rejects(drive(fixed, shiftPage(30, 'overflow-y:hidden')), /helper proof/);
});
