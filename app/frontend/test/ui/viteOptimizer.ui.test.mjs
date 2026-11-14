import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, optimizerNotes } from './uiSupport.mjs';

test.after(closeBrowser);

test('a UI test process starts its dev server on the prebundled dependencies and never re-optimizes them', async () => {
  const ui = await openUi('launch', {});
  try {
    await ui.page.getByPlaceholder('e.g. Contoso, Acme Corp, Retail Division').waitFor({ timeout: 20000 });
    assert.deepEqual(optimizerNotes, [], 'the dev server re-optimized its dependencies after start');
  } finally {
    await ui.close();
  }
});
