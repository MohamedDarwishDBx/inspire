/** Metric views are not tables: they are not listed, counted or read as a table. */

const { parseExactJson } = require('./exactJson');

const METRIC_VIEW_TABLE_TYPES = ['METRIC_VIEW', 'METRIC VIEW'];

const isMetricViewType = (type) => METRIC_VIEW_TABLE_TYPES.includes(String(type || '').trim().toUpperCase());

/**
 * The table type from one DESCRIBE TABLE EXTENDED ... AS JSON payload (its documented "type" field), upper case. The one parser of
 * that payload. A payload that is not JSON, or names no type, reads as null: an unknown type, which the caller fails closed on.
 */
function tableTypeOfDescribe(raw) {
  let meta;
  try {
    meta = typeof raw === 'string' && raw.trim().startsWith('{') ? parseExactJson(raw) : null;
  } catch {
    return null;
  }
  const kind = meta && typeof meta === 'object' && meta.type ? String(meta.type).trim().toUpperCase() : '';
  return kind || null;
}

/** Split listed tables into the ones kept and the metric views left out. */
function splitMetricViews(items, typeOf) {
  const kept = [];
  const skipped = [];
  for (const item of Array.isArray(items) ? items : []) {
    (isMetricViewType(typeOf(item)) ? skipped : kept).push(item);
  }
  return { kept, skipped };
}

/** The one log line a skip writes, so a run shows what it left out. */
function metricViewSkipLine(names) {
  const noun = names.length === 1 ? 'metric view' : 'metric views';
  return `[METRIC-VIEW SKIPPED] ${names.length} ${noun} left out: ${names.join(', ')}`;
}

/** The one plain line a Data Filters read returns for a metric view, instead of a SQL error. */
function metricViewRefusal(name) {
  return `${name} is a metric view, so Inspire leaves it out of Data Filters; pick its source table instead`;
}

/** The one plain reason an unknown-type table gives in the picker and in swap suggestions. */
const UNUSABLE_REASON = "Inspire could not read this table's type, so it cannot be used here. Pick another table you can read.";

/** The one log line the picker writes for the tables whose type it could not read (fail closed: shown as not usable). */
function tableTypeUnknownLine(count, where) {
  const noun = count === 1 ? 'table' : 'tables';
  return `[TABLE-TYPE UNKNOWN] ${count} ${noun} shown as not usable in ${where}: Inspire could not read their type`;
}

// The probe bounds mirror the agent notebook's values (streaming_batch_size and METADATA_PARALLELISM); the App and the
// notebook do not share a config, so the two are kept equal by hand.
const TABLE_TYPE_PROBE_CAP = 1000;
const TABLE_TYPE_PROBE_WORKERS = 8;

/**
 * Type every name with `typeOf` (null when its type cannot be read), TABLE_TYPE_PROBE_WORKERS at a time. Names beyond
 * TABLE_TYPE_PROBE_CAP are not typed and come back in `beyond`; the cap is logged when it is hit.
 */
async function probeTableTypes(names, typeOf) {
  const probed = names.slice(0, TABLE_TYPE_PROBE_CAP);
  const beyond = names.slice(TABLE_TYPE_PROBE_CAP);
  if (beyond.length) {
    console.log(`[TABLE-TYPE PROBE CAP] ${beyond.length} tables beyond the probe cap of ${TABLE_TYPE_PROBE_CAP} were not typed`);
  }
  const types = new Map();
  for (let i = 0; i < probed.length; i += TABLE_TYPE_PROBE_WORKERS) {
    const chunk = probed.slice(i, i + TABLE_TYPE_PROBE_WORKERS);
    const got = await Promise.all(chunk.map((name) => typeOf(name)));
    chunk.forEach((name, j) => types.set(name, got[j]));
  }
  return { types, beyond };
}

/** The named refusal a Data Filters or Data step read gives for a table whose type cannot be read (fail closed). */
function unknownTypeRefusal(name) {
  return `${name} is not usable. ${UNUSABLE_REASON}`;
}

module.exports = {
  METRIC_VIEW_TABLE_TYPES, isMetricViewType, splitMetricViews, metricViewSkipLine, metricViewRefusal,
  UNUSABLE_REASON, unknownTypeRefusal, tableTypeUnknownLine, probeTableTypes, TABLE_TYPE_PROBE_CAP, tableTypeOfDescribe,
};
