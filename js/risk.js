/* =====================================================================
 * risk.js — small, pure helpers for risk labels and road condition.
 *
 * Scenario mode: risk = the PRESET risk_level stored in the shared file
 *                (a display label, not a model output).
 * Live mode:     risk = sand_01 depth vs CONFIG.SAND_DEPTH_THRESHOLDS_CM,
 *                or null ("Not classified") while no thresholds are agreed.
 * Demo score:    classifyRisk() maps the 0–100 demo indicator to a band.
 * ===================================================================== */

// Keep any value inside 0–100 and round to one decimal place.
function clampLevel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.min(100, Math.max(0, n)) * 10) / 10;
}

// 0–100 score → "Low" | "Medium" | "High" using CONFIG.RISK_BANDS.
// The score is rounded first, so 30.4 counts as 30 (Low) and 30.5 as 31 (Medium).
function classifyRisk(score) {
  const level = Math.round(clampLevel(score));
  for (const band of CONFIG.RISK_BANDS) {
    if (level <= band.max) return band.level;
  }
  return CONFIG.RISK_BANDS[CONFIG.RISK_BANDS.length - 1].level;
}

// Text such as "0–30" for a demo score band.
function describeBandRange(index) {
  const bands = CONFIG.RISK_BANDS;
  const min = index === 0 ? 0 : bands[index - 1].max + 1;
  return `${min}–${bands[index].max}`;
}

// Live sand_01 depth (cm) → risk label, or null when thresholds are not set.
function classifySandDepth(depthCm) {
  const t = CONFIG.SAND_DEPTH_THRESHOLDS_CM;
  if (!t || typeof depthCm !== "number") return null;
  if (depthCm <= t.lowMax) return "Low";
  if (depthCm <= t.mediumMax) return "Medium";
  return "High";
}

// Risk label → { label, detail } for the road condition text.
function roadConditionForRisk(riskLabel) {
  return CONFIG.ROAD_CONDITION_BY_RISK[riskLabel] || null;
}
