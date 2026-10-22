/* =====================================================================
 * risk.js — turns a sand level (0–100 %) into a risk level and a
 * road condition, using the bands defined in config.js.
 * Pure functions: same input always gives the same output.
 * ===================================================================== */

// Keep any value inside 0–100 and round to one decimal place.
function clampLevel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.min(100, Math.max(0, n)) * 10) / 10;
}

// Returns "Low", "Medium" or "High" for a sand level.
// The level is rounded to a whole number first, so 30.4 % counts as 30 (Low)
// and 30.5 % counts as 31 (Medium), matching the "0–30 / 31–60 / 61–100" bands.
function classifyRisk(sandLevel) {
  const level = Math.round(clampLevel(sandLevel));
  for (const band of CONFIG.RISK_BANDS) {
    if (level <= band.max) return band.level;
  }
  return CONFIG.RISK_BANDS[CONFIG.RISK_BANDS.length - 1].level;
}

// Returns { label, detail } describing the road for a sand level.
function describeRoadCondition(sandLevel) {
  const level = clampLevel(sandLevel);
  for (const condition of CONFIG.ROAD_CONDITIONS) {
    if (level <= condition.max) return condition;
  }
  return CONFIG.ROAD_CONDITIONS[CONFIG.ROAD_CONDITIONS.length - 1];
}

// Text such as "0–30 %" for a risk band, used in the legend.
function describeBandRange(index) {
  const bands = CONFIG.RISK_BANDS;
  const min = index === 0 ? 0 : bands[index - 1].max + 1;
  return `${min}–${bands[index].max} %`;
}
