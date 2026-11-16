// The Agent page in a real browser: an agentic App opens on it, the briefing and chips show, an ask renders its blocks,
// and a Mark done goes through the confirm card before anything is written.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, openApp, serveDist, until } from './harness.mjs';

let served;
let browser;

before(async () => {
  served = await serveDist();
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  served?.close();
});

// D-NOAGENT (Amr 2026-11-16 02:27): the Agent link is hidden (AGENT_PAGE_SHOWN = false in src/App.jsx), so every App-level test
// that reaches the Agent page through its link or deep link is skipped by name. agentHidden.test.mjs covers the hidden state.
const HIDDEN = { skip: 'D-NOAGENT: the Agent page is hidden (AGENT_PAGE_SHOWN = false in src/App.jsx)' };

const AGENTIC = { options: { modify: false, replace_edits: false, decisions: true, alerts: false, experience: 'agentic' } };
const TICKETS = [
  { record_key: 'r-100', label: 'Unit A', value_at_stake: '900000', tier: 'High', status: 'Open', why: 'Overdue invoices', due: '' },
  { record_key: 'r-200', label: 'Unit B', value_at_stake: '40000', tier: 'Low', status: 'Open', why: 'Small gap', due: '' },
];
const briefing = (page) => ({ page, total: 2, tickets: TICKETS, actions: ['done', 'snooze', 'assign'], chips: ['Tell me what to do', 'What is the value at stake?'] });

test('an agentic App opens on the Agent page, with the briefing, the box and the chips', HIDDEN, async () => {
  const info = appInfo(AGENTIC);
  const pageId = info.pages[0].id;
  const routes = { 'agent/briefing': ({ json }) => json(200, briefing(pageId)), 'agent/status': ({ json }) => json(200, { mode: 'agent', note: '', page: pageId, genie: true, model: 'x' }) };
  const { page, seen, context } = await openApp(browser, served.base, info, { routes, hash: `#/${pageId}/agent`, ready: '[data-agent-page]' });
  try {
    await page.locator('[data-agent-page]').waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-ticket]').count(), 2, 'two tickets in the briefing');
    assert.ok(await page.getByRole('searchbox', { name: 'Ask the agent' }).count() + await page.getByRole('textbox', { name: 'Ask the agent' }).count() >= 1, 'the ask box is there');
    assert.ok(await page.getByRole('button', { name: 'Tell me what to do' }).count() === 1, 'the chip is there');
    assert.deepEqual(seen.errors.filter((e) => !/favicon|Failed to load resource/.test(e)), [], 'no page errors');
  } finally {
    await context.close();
  }
});

test('a Mark done on a briefing ticket asks for confirmation first, and writes only after Confirm', HIDDEN, async () => {
  const info = appInfo(AGENTIC);
  const pageId = info.pages[0].id;
  const calls = { act: 0, prepare: 0 };
  const routes = {
    'agent/briefing': ({ json }) => json(200, briefing(pageId)),
    'agent/prepare': ({ json }) => { calls.prepare += 1; return json(200, { confirm: { action: 'done', label: 'Mark done', route: 'records/act', rows: [{ record_key: 'r-100', label: 'Unit A' }], values: {}, body: { page: pageId, record_keys: ['r-100'], seen: {}, values: {} } } }); },
    'records/act': ({ json }) => { calls.act += 1; return json(200, { written: [{ record_key: 'r-100' }], conflicts_count: 0, batch_id: 'b1' }); },
  };
  const { page, context } = await openApp(browser, served.base, info, { routes, hash: `#/${pageId}/agent`, ready: '[data-agent-page]' });
  try {
    await page.locator('[data-ticket="r-100"] [data-action="done"]').click();
    await page.locator('[data-confirm="ask"]').waitFor({ timeout: 10000 });
    await until(() => calls.prepare === 1, 5000);
    assert.equal(calls.act, 0, 'nothing is written before Confirm');
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await until(() => calls.act === 1, 5000);
  } finally {
    await context.close();
  }
});

test('a question renders its answer as blocks: text, a choice, a multi-select, a KPI and an email draft', HIDDEN, async () => {
  const info = appInfo(AGENTIC);
  const pageId = info.pages[0].id;
  const turn = {
    turn_id: 'a'.repeat(32), state: 'done', steps: [{ tool: 'find_records', text: 'Looked at 2 records of 2' }], answer: '', error: '', confirm: null,
    refused: false, offers: null, next: [], conversation_id: '', actions: [], model: 'x', genie: null,
    blocks: [
      { type: 'text', markdown: 'Act on **Unit A** first.' },
      { type: 'choice', prompt: 'Which owner?', options: [{ id: 'ana', label: 'Ana', ask: 'Show the records for Ana' }, { id: 'bo', label: 'Bo' }] },
      { type: 'multi_select', prompt: 'Which units?', ask: 'Draft a note for', min: 1, max: 2, submit: 'Use these',
        options: [{ id: 'r-100', label: 'Unit A', detail: '$900k' }, { id: 'r-200', label: 'Unit B' }] },
      { type: 'kpi', kpi_id: 'loss', value: '$940k', value_at_stake: '', note: 'Across both units' },
      { type: 'email', to_label: 'Ana', subject: 'Unit A invoices', body: 'Hi Ana,\nPlease check Unit A.', copyable: true },
    ],
  };
  const routes = {
    'agent/briefing': ({ json }) => json(200, briefing(pageId)),
    'agent/ask': ({ json }) => json(200, turn),
  };
  const { page, seen, context } = await openApp(browser, served.base, info, { routes, hash: `#/${pageId}/agent`, ready: '[data-agent-page]' });
  try {
    await page.getByRole('button', { name: 'Tell me what to do' }).click();
    await page.locator('[data-block="email"]').waitFor({ timeout: 10000 });
    assert.equal(await page.locator('[data-block="choice"] select').count(), 1, 'the decision is a dropdown');
    assert.equal(await page.locator('[data-block="multi_select"] input[type="checkbox"]').count(), 2, 'the choices are cards');
    assert.match(await page.locator('[data-block="text"]').innerText(), /Act on Unit A first\./);
    assert.match(await page.locator('[data-block="email"]').innerText(), /Unit A invoices/);
    assert.deepEqual(seen.errors.filter((e) => !/favicon|Failed to load resource/.test(e)), [], 'no page errors');
  } finally {
    await context.close();
  }
});

test('chart, KPI, table, carousel and feedback blocks render, and the carousel and feedback work', HIDDEN, async () => {
  const info = appInfo(AGENTIC);
  const pageId = info.pages[0].id;
  const page = info.pages[0];
  const answered = [];
  const turn = {
    turn_id: 'b'.repeat(32), state: 'done', steps: [], answer: '', error: '', confirm: null, refused: false, offers: null, next: [],
    conversation_id: '', actions: [], model: 'x', genie: null,
    blocks: [
      { type: 'chart', chart_id: 'loss_trend', title: 'Loss over time', highlight_keys: [] },
      { type: 'kpi', kpi_id: 'total_loss', value: '$940,000', value_at_stake: '', note: 'Across both units' },
      { type: 'table', columns: ['category', 'value'], record_keys: ['r-100'], limit: 5, rows: [{ record_key: 'r-100', category: 'North', value: '900' }] },
      { type: 'carousel', items: [
        { type: 'ticket', record_key: 'r-100', label: 'Unit A', value_at_stake: '900000', status: 'Open', why: 'Overdue', tier: '', due: '' },
        { type: 'ticket', record_key: 'r-200', label: 'Unit B', value_at_stake: '40000', status: 'Open', why: 'Small', tier: '', due: '' },
      ] },
      { type: 'feedback' },
    ],
  };
  const routes = {
    'agent/briefing': ({ json }) => json(200, briefing(pageId)),
    'agent/ask': ({ json }) => json(200, turn),
    'agent/feedback': ({ json, route }) => { answered.push(route.request().postData()); return json(200, {}); },
    page: ({ json }) => json(200, { charts: { loss_trend: { rows: [{ x: '2026-10-01', y0: 1200 }, { x: '2026-11-01', y0: 1500 }] } } }),
  };
  const { page: browserPage, seen, context } = await openApp(browser, served.base, info, { routes, hash: `#/${pageId}/agent`, ready: '[data-agent-page]' });
  try {
    await browserPage.getByRole('button', { name: 'Tell me what to do' }).click();
    await browserPage.locator('[data-block="carousel"]').waitFor({ timeout: 10000 });
    assert.equal(await browserPage.locator('[data-block="kpi"]').count(), 1, 'the KPI tile');
    assert.match(await browserPage.locator('[data-block="kpi"]').innerText(), /\$940,000/);
    assert.equal(await browserPage.locator('[data-block="table"] tbody tr').count(), 1, 'the table row');
    await browserPage.locator('[data-block="chart"] canvas').first().waitFor({ timeout: 15000 });
    assert.equal(await browserPage.locator('[data-block="chart"] canvas').count(), 1, 'the chart is drawn');
    assert.match(await browserPage.locator('[data-block="chart"]').innerText(), /Loss over time/);
    assert.match(await browserPage.locator('[data-block="carousel"]').innerText(), /Unit A/);
    await browserPage.getByRole('button', { name: 'Next record' }).click();
    assert.match(await browserPage.locator('[data-block="carousel"]').innerText(), /Unit B/, 'the carousel moves to the next record');
    await browserPage.getByRole('button', { name: 'Helpful', exact: true }).click();
    await until(() => answered.length === 1, 5000);
    assert.match(answered[0], /"rating":"POSITIVE"/);
    assert.deepEqual(seen.errors.filter((e) => !/favicon|Failed to load resource/.test(e)), [], 'no page errors');
  } finally {
    await context.close();
  }
});

test('saved conversations list the person\'s threads, and a thread opens to its answers', HIDDEN, async () => {
  const info = appInfo(AGENTIC);
  const pageId = info.pages[0].id;
  const threads = { threads: [{ thread_id: 'd'.repeat(32), title: 'Which units?', updated_at: '2026-11-14', turns: [
    { question: 'Which units?', answer: 'Unit A first.', blocks: [{ type: 'text', markdown: 'Unit A first.' }] }] }], note: '' };
  const routes = { 'agent/briefing': ({ json }) => json(200, briefing(pageId)), 'agent/threads': ({ json }) => json(200, threads) };
  const { page, seen, context } = await openApp(browser, served.base, info, { routes, hash: `#/${pageId}/agent`, ready: '[data-agent-page]' });
  try {
    await page.locator('details.agp-saved summary').first().click();
    await page.getByText('Which units?', { exact: false }).first().waitFor({ timeout: 10000 });
    assert.equal(await page.locator('details.agp-saved').count(), 1);
    assert.match(await page.locator('details.agp-saved').innerText(), /Saved conversations \(1\)/);
    assert.deepEqual(seen.errors.filter((e) => !/favicon|Failed to load resource/.test(e)), [], 'no page errors');
  } finally {
    await context.close();
  }
});

test('an outlier page shows its kind question as the first chip, and clicking it asks that question', HIDDEN, async () => {
  const info = appInfo(AGENTIC);
  const pageId = info.pages[0].id;
  const kindQuestion = 'Which values break their expected range, and which ones need someone to look?';
  const asked = [];
  const routes = {
    'agent/briefing': ({ json }) => json(200, { ...briefing(pageId), chips: [kindQuestion, 'Tell me what to do'] }),
    'agent/ask': ({ json, route }) => { asked.push(route.request().postData()); return json(200, { turn_id: 'e'.repeat(32), state: 'done', steps: [], answer: '', blocks: [{ type: 'text', markdown: 'Two values are outside the range.' }], confirm: null, refused: false, offers: null, next: [], conversation_id: '', actions: [], model: 'x', genie: null }); },
  };
  const { page, seen, context } = await openApp(browser, served.base, info, { routes, hash: `#/${pageId}/agent`, ready: '[data-agent-page]' });
  try {
    const chip = page.locator('.agp-chips button').first();
    assert.equal((await chip.innerText()).trim(), kindQuestion);
    await chip.click();
    await until(() => asked.length === 1, 5000);
    assert.match(asked[0], /break their expected range/);
    await page.locator('[data-block="text"]').waitFor({ timeout: 10000 });
    assert.deepEqual(seen.errors.filter((e) => !/favicon|Failed to load resource/.test(e)), [], 'no page errors');
  } finally {
    await context.close();
  }
});

// Three records of one franchise, told apart only by their key (the label column is the franchise alone).
const SAME_LABEL = [
  { record_key: 'f-1 | 2024-05-19', label: 'Franchise 3000000', value_at_stake: '1700', tier: 'Act now', status: 'New', why: 'forecast gap', due: '' },
  { record_key: 'f-1 | 2024-05-20', label: 'Franchise 3000000', value_at_stake: '1700', tier: 'Act now', status: 'New', why: 'forecast gap', due: '' },
  { record_key: 'f-1 | 2024-05-21', label: 'Franchise 3000000', value_at_stake: '1700', tier: 'Act now', status: 'New', why: 'forecast gap', due: '' },
];

test('three distinct records give three distinct cards on the Agent page, each showing its own key', HIDDEN, async () => {
  const info = appInfo(AGENTIC);
  const pageId = info.pages[0].id;
  const routes = { 'agent/briefing': ({ json }) => json(200, { ...briefing(pageId), total: 3, tickets: SAME_LABEL }) };
  const { page, seen, context } = await openApp(browser, served.base, info, { routes, hash: `#/${pageId}/agent`, ready: '[data-agent-page]' });
  try {
    await page.locator('[data-ticket]').nth(2).waitFor({ timeout: 20000 });
    const keys = await page.locator('[data-ticket]').evaluateAll((els) => els.map((e) => e.getAttribute('data-ticket')));
    assert.equal(new Set(keys).size, 3, 'three cards for three records, not one record three times');
    const texts = await page.locator('[data-ticket]').evaluateAll((els) => els.map((e) => e.innerText));
    assert.equal(new Set(texts).size, 3, 'each card reads differently, so a person can tell them apart');
    assert.match(texts[0], /2024-05-19/);
    assert.match(texts[2], /2024-05-21/);
    assert.deepEqual(seen.errors.filter((e) => !/favicon|Failed to load resource/.test(e)), [], 'no page errors');
  } finally {
    await context.close();
  }
});

test('the Agent input takes typing while a question is still running, and Enter sends the next question', HIDDEN, async () => {
  const info = appInfo(AGENTIC);
  const pageId = info.pages[0].id;
  const asked = [];
  const running = { turn_id: 'c'.repeat(32), state: 'running', steps: [{ tool: 'find_records', text: 'Looking' }], answer: '', error: '', confirm: null, refused: false, offers: null, next: [],
    conversation_id: '', actions: [], model: 'x', genie: null, blocks: [] };
  const done = { ...running, state: 'done', steps: [], blocks: [{ type: 'text', markdown: 'Second question answered.' }] };
  let polls = 0;
  const routes = {
    'agent/briefing': ({ json }) => json(200, briefing(pageId)),
    'agent/ask': ({ json, route }) => { asked.push(JSON.parse(route.request().postData()).question); return json(200, running); },
    'agent/turn': ({ json }) => { polls += 1; return json(200, polls < 8 ? running : done); },
  };
  const { page, seen, context } = await openApp(browser, served.base, info, { routes, hash: `#/${pageId}/agent`, ready: '[data-agent-page]' });
  try {
    const box = page.getByRole('textbox', { name: 'Ask the agent' });
    await box.click();
    await box.pressSequentially('Which franchise is most overdue?');
    await box.press('Enter');
    await until(() => asked.length === 1, 5000);
    await page.locator('.agp-turn').first().waitFor({ timeout: 5000 });
    assert.equal(await box.isEnabled(), true, 'the input is not locked while the first question runs');
    await box.click();
    await box.pressSequentially('Then which one is largest?');
    assert.equal(await box.inputValue(), 'Then which one is largest?', 'typing lands in the box while a question is running');
    await box.press('Enter');
    await page.getByRole('status').filter({ hasText: 'Wait for the current answer, then ask again' }).waitFor({ timeout: 5000 });
    assert.equal(asked.length, 1, 'Enter during a running question does not send a second question');
    assert.equal(await box.inputValue(), 'Then which one is largest?', 'the typed question is kept, not dropped');
    await until(() => polls >= 8, 15000);
    await box.press('Enter');
    await until(() => asked.length === 2, 5000);
    assert.equal(asked[1], 'Then which one is largest?');
    assert.deepEqual(seen.errors.filter((e) => !/favicon|Failed to load resource/.test(e)), [], 'no page errors');
  } finally {
    await context.close();
  }
});

test('the record link on an Agent page card opens that record, with its own key', HIDDEN, async () => {
  const info = appInfo(AGENTIC);
  const pageId = info.pages[0].id;
  const routes = { 'agent/briefing': ({ json }) => json(200, { ...briefing(pageId), total: 3, tickets: SAME_LABEL }) };
  const { page, seen, context } = await openApp(browser, served.base, info, { routes, hash: `#/${pageId}/agent`, ready: '[data-agent-page]' });
  try {
    await page.locator('[data-ticket]').nth(1).waitFor({ timeout: 20000 });
    await page.locator('[data-ticket]').nth(1).getByRole('button', { name: 'Franchise 3000000' }).click();
    await until(() => new URL(page.url()).hash.includes('rec='), 5000);
    const rec = new URLSearchParams(new URL(page.url()).hash.split('?')[1] || '').get('rec');
    assert.equal(rec, 'f-1 | 2024-05-20', 'the link opens the record it sits on, not undefined');
    assert.deepEqual(seen.errors.filter((e) => !/favicon|Failed to load resource/.test(e)), [], 'no page errors');
  } finally {
    await context.close();
  }
});
