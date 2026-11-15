import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalHash } from '../src/links.js';
import { SECTION_TITLES } from '../src/modes.js';

const pages = [{ id: 'loss', title: 'Loss' }];
const sectionsOf = (sections) => () => sections;

test('the Agent section has a title', () => {
  assert.equal(SECTION_TITLES.agent, 'Agent');
});

test('an agentic App with an Agent section lands on it when the link names no section', () => {
  const next = canonicalHash('#/loss', { pages, sectionsOf: sectionsOf(['agent', 'dashboard', 'work']), landingOf: () => 'agent' });
  assert.equal(next, '#/loss/agent');
});

test('a link that names a section keeps it, so the side menu still reaches the classic pages', () => {
  const next = canonicalHash('#/loss/dashboard', { pages, sectionsOf: sectionsOf(['agent', 'dashboard']), landingOf: () => 'agent' });
  assert.equal(next, null, 'already canonical: nothing to rewrite');
});

test('a classic App, or one without the Agent section, lands on the dashboard as before', () => {
  const classic = canonicalHash('#/loss', { pages, sectionsOf: sectionsOf(['dashboard', 'work']) });
  assert.equal(classic, '#/loss/dashboard');
  const noAgent = canonicalHash('#/loss', { pages, sectionsOf: sectionsOf(['dashboard']), landingOf: () => 'agent' });
  assert.equal(noAgent, '#/loss/dashboard', 'a landing the App does not show falls back to the dashboard');
});
