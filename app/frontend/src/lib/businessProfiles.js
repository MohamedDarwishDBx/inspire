// Business profiles (REQ-364 to REQ-366): helpers the Start form and the Start list share.

// The four "you chose this yourself" flags. They decide whether a heuristic may fill a field, not what the form shows.
const TOUCH_FLAGS = ['electionTouched', 'discoveryTouched', 'strategyTouched', 'prioritiesTouched'];

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

// The settings a profile is compared on: the whole form without the touch flags. Key order never matters.
export function sameSettings(form, spec) {
  const shown = (value) => {
    const copy = { ...(value || {}) };
    for (const key of TOUCH_FLAGS) delete copy[key];
    return JSON.stringify(canonical(copy));
  };
  return shown(form) === shown(spec);
}

// inspire_profile_<name>.json. Characters a file system refuses become dashes, spaces become underscores.
export function profileFileName(name) {
  const safe = [...String(name || '').trim()].map((c) => (c.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(c) ? '-' : c)).join('').replace(/\s+/g, '_');
  return `inspire_profile_${safe || 'profile'}.json`;
}

// The file a Download writes: the profile's name, who saved it and when, and the settings exactly as the App stored them.
export function profileFileText(profile) {
  return `${JSON.stringify({
    format: 'inspire_profile',
    version: 1,
    name: profile.name,
    business_name: profile.business_name || '',
    saved_by: profile.saved_by || '',
    saved_at: profile.saved_at || null,
    spec: profile.spec || {},
  }, null, 2)}\n`;
}
