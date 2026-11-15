// REQ-115 / REQ-234: the App reports the release a person installed (the installer stamps INSPIRE_RELEASE_TAG into app.yaml),
// so rc.1 and rc.2 read differently. A missing or malformed tag falls back to the package version.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { INSPIRE_AGENT_VERSION, inspireReleaseLabel } = require('../lib/inspireJobParams');

test('the App shows the installed release tag, rc number included', () => {
  assert.equal(inspireReleaseLabel({ INSPIRE_RELEASE_TAG: 'v1.5.3-rc.2' }), 'v1.5.3-rc.2');
  assert.equal(inspireReleaseLabel({ INSPIRE_RELEASE_TAG: 'v1.5.3-rc.1' }), 'v1.5.3-rc.1');
  assert.equal(inspireReleaseLabel({ INSPIRE_RELEASE_TAG: 'v1.5.3' }), 'v1.5.3');
});

test('without a tag, or with one that is not a release tag, the App shows the package version', () => {
  assert.equal(inspireReleaseLabel({}), INSPIRE_AGENT_VERSION);
  for (const bad of ['', '  ', '1.5.3', 'v1.5.3-rc.10', 'v1.5.3-rc.2-dry', 'v1.5.3; rm -rf', 'v1.5.3-beta.1', 'v1.5.10']) {
    assert.equal(inspireReleaseLabel({ INSPIRE_RELEASE_TAG: bad }), INSPIRE_AGENT_VERSION, `tag ${JSON.stringify(bad)}`);
  }
});

test('the status and defaults endpoints report the release label, not the constant', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const reported = server.match(/agentVersion: [^,\n]+/g) || [];
  assert.deepEqual(reported, ['agentVersion: inspireReleaseLabel()', 'agentVersion: inspireReleaseLabel()']);
});
