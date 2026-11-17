const test = require('node:test');
const assert = require('node:assert/strict');
const { installerDataCatalogs } = require('../lib/installerDataCatalogs');
const { startInspire } = require('./support/serverProcess');

test('the installer catalog setting is read as the pick order, and every blank or unusable value means no setting (REQ-359)', () => {
  assert.deepEqual(installerDataCatalogs('["sales","hr"]'), ['sales', 'hr'], 'the pick order is kept');
  assert.deepEqual(installerDataCatalogs(' ["sales", "  ", "hr"] '), ['sales', 'hr'], 'blank names are dropped');
  for (const raw of [undefined, null, '', '   ', '[]', '["  "]', 'not json', '{"a":"sales"}', '"sales"', 'null', '["sales", 5]', '[null]']) {
    assert.equal(installerDataCatalogs(raw), null, `${JSON.stringify(raw)} means every catalog, not an empty list (must-exclude)`);
  }
});

test('/api/defaults hands the installer catalog list to the App, and says null when the install carried none (REQ-359)', async () => {
  const withList = await startInspire({ INSPIRE_DATA_CATALOGS: '["sales","hr"]' });
  try {
    const defaults = await (await fetch(`${withList.url}/api/defaults`)).json();
    assert.deepEqual(defaults.installerDataCatalogs, ['sales', 'hr']);
  } finally {
    await withList.stop();
  }
  const without = await startInspire({});
  try {
    const defaults = await (await fetch(`${without.url}/api/defaults`)).json();
    assert.equal(defaults.installerDataCatalogs, null, 'an older install shows every catalog, as before');
  } finally {
    await without.stop();
  }
});
