export const MONEY_PARTS = ['method', 'direction', 'currency', 'window', 'off'];
// Every Measure screen in order. The sign decision (which records are gains) is a screen of its own, after the direction,
// and only the Gains movement needs it: the other movements skip that screen entirely.
const SCREEN_PARTS = ['method', 'direction', 'sign', 'currency', 'window', 'off'];
export function moneyPartsOf(rule) {
  return rule === 'gains' ? SCREEN_PARTS : SCREEN_PARTS.filter((p) => p !== 'sign');
}
