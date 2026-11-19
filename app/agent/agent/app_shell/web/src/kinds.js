import REGISTRY from '../../kinds.json' with { type: 'json' };

export const KINDS = REGISTRY;

const byId = (list, id) => list.find((item) => item.id === id) || null;
const techniqueKey = (technique) => String(technique ?? '').split(/\s+/).filter(Boolean).join(' ').toLowerCase();

export const kindOf = (id) => byId(REGISTRY.kinds, id);
export const familyOf = (id) => byId(REGISTRY.families, id);
export const contractOf = (id) => (id && REGISTRY.contracts?.[id]) || null;

export function kindForTechnique(technique) {
  const label = techniqueKey(technique);
  const key = Object.keys(REGISTRY.technique_kind).find((name) => name.toLowerCase() === label);
  return key ? kindOf(REGISTRY.technique_kind[key]) : null;
}

// App styles: each kind is drawn in one style (header kicker, first screen, theme). A kind with no style of its own takes its family's.
// A kind the registry does not know gets null, so the page draws in today's layout.
export const styleById = (id) => (id ? (REGISTRY.app_styles || []).find((style) => style.id === id) || null : null);
export const styleOfKind = (kind) => (kind ? styleById(kind.app_style || familyOf(kind.family)?.app_style) : null);

const LAT = /^(lat|latitude)$/i;
const LONG = /^(lon|lng|long|longitude)$/i;
// A map needs both a latitude and a longitude column somewhere on the page (records or tables).
export function hasCoordinates(page) {
  const names = [...(page?.records?.columns || []), ...(page?.records?.detail || []), ...(page?.tables || []).flatMap((t) => t.columns || [])]
    .map((c) => String(c?.column || ''));
  return names.some((n) => LAT.test(n)) && names.some((n) => LONG.test(n));
}

// The style a page is drawn in. A style that needs data the page lacks (a map without coordinates) draws as its fallback instead.
export function styleOfPage(page) {
  const style = styleOfKind(kindOf(page?.kind));
  if (style?.needs?.coordinates && !hasCoordinates(page)) return styleById(style.fallback);
  return style;
}

// Moves the sections a style leads with to the top of the first screen, in the style's order. The rest keep the layout's order.
export function leadSections(style, sections, holds = {}) {
  if (!style?.lead?.length) return sections;
  const rank = (section) => {
    const hits = [style.lead.indexOf(section), style.lead.indexOf(holds[section])].filter((i) => i >= 0);
    return hits.length ? Math.min(...hits) : Infinity;
  };
  const leading = sections.filter((s) => rank(s) !== Infinity).sort((a, b) => rank(a) - rank(b));
  return [...leading, ...sections.filter((s) => rank(s) === Infinity)];
}
