const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { BOOT_GUARD_SCRIPT_HASH } = require('../lib/bootGuardCsp');
const { pageCsp, sameOriginCsp, hostedCsp } = require('../lib/hostedRun');

const GUARD = fs.readFileSync(path.join(__dirname, '..', '..', 'shared', 'bootGuard.js'), 'utf8');
const hashOf = (text) => `sha256-${crypto.createHash('sha256').update(text).digest('base64')}`;

// The inline text is "\n" + bootGuard.js, between <script> and </script>. A guard edit without a build changes this hash and fails here.
test('the CSP hash is the hash of the inline guard text as the build writes it', () => {
  assert.equal(BOOT_GUARD_SCRIPT_HASH, hashOf(`\n${GUARD}`));
});

test('every CSP Inspire emits for an App page allows the guard by hash, and no other inline script', () => {
  const policies = [pageCsp('https://workspace.example.com', '/run/n01-u01-42/'), sameOriginCsp(), hostedCsp('https://workspace.example.com', 'n01-u01-42')];
  for (const policy of policies) {
    const scriptSrc = policy.split(';').find((part) => part.trim().startsWith('script-src'));
    assert.ok(scriptSrc.includes(`'${BOOT_GUARD_SCRIPT_HASH}'`), `script-src carries the guard hash: ${scriptSrc}`);
    assert.ok(!scriptSrc.includes("'unsafe-inline'"), 'no unsafe-inline');
  }
});
