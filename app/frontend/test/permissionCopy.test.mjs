// REQ-300: Copy carries only the GRANT statements; the admin heading is short, and no line repeats "Ask your admin".
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyText, grantAsk } from '../src/lib/permissionBus.js';

const GRANT = 'GRANT SELECT ON TABLE `main`.`s`.`orders` TO `owner@example.com`';

test('the copy payload is the GRANT statements only: a reason and a non-grant step never reach the clipboard', () => {
  const permissions = [{
    statements: [GRANT],
    instructions: ['The App inspire-fwa reads main.s.orders directly. Rebuild the App so it reads through its views, then click Try again.'],
    principal: 'owner@example.com',
    why: 'amr.ali opens the App and reads its data with their own access.',
  }];
  assert.equal(copyText(permissions), `${GRANT};`);
});

test('a dialog with only a non-grant step has nothing to copy', () => {
  assert.equal(copyText([{ statements: [], instructions: ['Rebuild the App.'], principal: 'app' }]), '');
});

test('each statement is copied on its own line, each ending with a semicolon, across every grantee', () => {
  const permissions = [
    { statements: [GRANT], principal: 'a@x.com' },
    { statements: ['GRANT USE SCHEMA ON SCHEMA `main`.`s` TO `admins`;'], principal: 'admins' },
  ];
  assert.equal(copyText(permissions), `${GRANT};\nGRANT USE SCHEMA ON SCHEMA \`main\`.\`s\` TO \`admins\`;`);
});

test('a required grant has a short heading for its grantee, never the repeated Ask your admin sentence', () => {
  assert.equal(grantAsk({ statements: [GRANT], principal: 'owner@example.com' }), 'For owner@example.com');
  assert.equal(grantAsk({ statements: [GRANT] }), 'For your admin');
  assert.doesNotMatch(grantAsk({ statements: [GRANT], principal: 'x' }), /Ask your admin/);
});
