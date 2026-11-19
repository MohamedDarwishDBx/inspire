// REQ-416: each kind is drawn in one of 12 App styles. The style comes from the kind's registry entry (family default when the kind has none),
// a map without coordinates falls back, an unknown kind keeps today's layout, and the first screen follows the style's lead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { familyOf, hasCoordinates, kindOf, leadSections, styleById, styleOfKind, styleOfPage } from '../src/kinds.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY = JSON.parse(readFileSync(join(HERE, '..', '..', 'kinds.json'), 'utf8'));
const STYLE_IDS = ['news', 'league', 'mail', 'kanban', 'sheet', 'lab', 'cockpit', 'map', 'flow', 'graph', 'answer', 'agent'];
const WHO = { news: 'variance_to_plan', league: 'peer_benchmarking', mail: 'risk_propensity', kanban: 'controls_testing', sheet: 'allocation',
  lab: 'pricing', cockpit: 'forecast', map: 'site_territory', flow: 'journey_path', graph: 'fraud_rings', answer: 'data_agent' };

test('the registry defines exactly the 12 approved App styles, each with a label, a theme and a lead', () => {
  assert.deepEqual(REGISTRY.app_styles.map((s) => s.id), STYLE_IDS);
  for (const style of REGISTRY.app_styles) {
    assert.ok(style.label, `${style.id} has a label`);
    assert.ok(style.theme, `${style.id} has a theme`);
    assert.ok(Array.isArray(style.lead) && style.lead.length > 0, `${style.id} leads with at least one section`);
  }
});

test('every kind in the registry is drawn in one of the 12 styles, through its own app_style', () => {
  for (const kind of REGISTRY.kinds) {
    assert.ok(STYLE_IDS.includes(kind.app_style), `${kind.id} has app_style ${kind.app_style}`);
    assert.equal(styleOfKind(kind).id, kind.app_style, `${kind.id} resolves to its own style`);
  }
});

test('the wireframe choice holds for representative kinds (variance to news, map to map, data agent to answer)', () => {
  const withCoordinates = { records: { detail: [{ column: 'lat' }, { column: 'lon' }] } };
  for (const [style, kindId] of Object.entries(WHO)) {
    assert.equal(styleOfPage({ kind: kindId, ...withCoordinates }).id, style, `${kindId} is drawn as ${style}`);
  }
});

test('a kind with no app_style of its own takes its family default through familyOf', () => {
  const kind = { id: 'future_kind', family: 'predict' };
  assert.equal(familyOf('predict').app_style, 'cockpit');
  assert.equal(styleOfKind(kind).id, 'cockpit', 'the family default draws the new kind');
  assert.equal(styleOfKind({ id: 'orphan', family: 'no_such_family' }), null, 'a kind in no known family has no style');
});

test('an unknown kind or a page with no kind falls back to today\'s layout (no style)', () => {
  assert.equal(styleOfPage({ kind: 'not_a_kind' }), null);
  assert.equal(styleOfPage({}), null);
  assert.equal(styleOfPage(null), null);
  assert.equal(styleById('nope'), null);
  assert.equal(styleOfKind(undefined), null);
  assert.equal(kindOf('not_a_kind'), null);
});

test('a map without a latitude and a longitude column falls back to the league table and says so', () => {
  assert.equal(styleOfPage({ kind: 'site_territory', records: { columns: [{ column: 'entity' }] } }).id, 'league');
  assert.equal(styleOfPage({ kind: 'site_territory' }).id, 'league', 'no columns at all falls back too');
  assert.equal(styleOfPage({ kind: 'site_territory' }).label, 'League table');
});

test('a map draws as a map when latitude and longitude are on the page, in records or in a table', () => {
  assert.equal(styleOfPage({ kind: 'site_territory', records: { columns: [{ column: 'lat' }, { column: 'lng' }] } }).id, 'map');
  assert.equal(styleOfPage({ kind: 'site_territory', tables: [{ columns: [{ column: 'latitude' }, { column: 'longitude' }] }] }).id, 'map');
});

test('coordinates need both halves: a latitude alone does not make a map', () => {
  assert.equal(hasCoordinates({ records: { columns: [{ column: 'lat' }], detail: [{ column: 'city' }] } }), false);
  assert.equal(hasCoordinates({ records: { detail: [{ column: 'lon' }] } }), false);
  assert.equal(hasCoordinates({ records: { detail: [{ column: 'latitude' }, { column: 'longitude' }] } }), true);
});

test('the lead moves its sections to the top of the first screen in the style order, the rest keep the layout order', () => {
  const sections = ['todo', 'kpis', 'decision_list', 'charts', 'tables'];
  assert.deepEqual(leadSections(styleById('news'), sections, {}), ['kpis', 'todo', 'decision_list', 'charts', 'tables']);
  assert.deepEqual(leadSections(styleById('agent'), sections, {}), ['todo', 'kpis', 'decision_list', 'charts', 'tables']);
  assert.deepEqual(leadSections(styleById('mail'), ['todo', 'kpis', 'triage_queue', 'x'], { triage_queue: 'records' }), ['triage_queue', 'todo', 'kpis', 'x']);
  assert.deepEqual(leadSections(null, sections, {}), sections, 'no style keeps the layout order');
});

test('a lab leads with its levers, a scenario and a target, in that order, whatever the layout order', () => {
  const sections = ['kpis', 'target_gauge', 'outcome_distribution', 'lever_sliders', 'tornado'];
  const holds = { target_gauge: 'target', outcome_distribution: 'scenario', lever_sliders: 'levers' };
  assert.deepEqual(leadSections(styleById('lab'), sections, holds), ['lever_sliders', 'outcome_distribution', 'target_gauge', 'kpis', 'tornado']);
});

test('the agent style is a console over the page; it names no Agent page and leads only with the page\'s own sections', () => {
  const agent = styleById('agent');
  assert.equal(agent.label, 'Agent console');
  assert.ok(!agent.lead.includes('agent'), 'the lead does not point at the hidden Agent page');
  assert.equal(agent.needs, undefined, 'the agent style needs no data the page may lack');
});
