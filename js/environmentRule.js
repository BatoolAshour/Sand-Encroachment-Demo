/* =====================================================================
 * environmentRule.js — DEMONSTRATION rule that shows how several
 * environmental and satellite-derived variables COULD be combined into
 * a sand encroachment risk indicator.
 *
 *   This is NOT a scientifically validated model and NOT the future
 *   AI prediction model. It exists to explain the idea during the demo.
 *
 * score = 100 × Σ (weight × factor)      factor = 0…1 per variable
 * Weights and scaling ranges are in CONFIG.DEMO_RULE (config.js).
 * The score is classified with the same RISK_BANDS as the road sand level.
 *
 * Separate from classifyRisk() in risk.js: the main Low/Medium/High
 * indicator still comes from the simulated sand level on the road.
 * ===================================================================== */

// Straight-line scaling to 0–1. Works when low > high (reversed factors).
function scaleFactor(value, low, high) {
  const t = (value - low) / (high - low);
  return Math.min(1, Math.max(0, t));
}

// Reads the variable used by each rule entry from an environment record.
function ruleInputValue(env, key) {
  return key === "wind_speed_mps" ? env.weather.wind_speed_mps : env.satellite[key];
}

/* Returns:
 * {
 *   score: 56,                     0–100 (null if sand coverage is missing)
 *   level: "Medium",               via classifyRisk()
 *   contributions: [ { key, label, value, factor, points, available }, … ]  biggest first
 *   missing: ["Wind speed"],       inputs that were not available
 *   explanation: "…one or two sentences…"
 * }
 * A missing input is never guessed. With some inputs missing (e.g. a real
 * Sentinel-2 analysis has no wind speed), the score uses only the available
 * ones, rescaled by their total weight, and says so ("partial").
 */
function assessEnvironmentalIndicator(env) {
  if (!env) return null;
  const contributions = Object.entries(CONFIG.DEMO_RULE).map(([key, rule]) => {
    const value = ruleInputValue(env, key);
    const available = typeof value === "number" && Number.isFinite(value);
    const factor = available ? scaleFactor(value, rule.low, rule.high) : null;
    return { key, label: rule.label, value, factor, available, points: available ? rule.weight * factor * 100 : 0 };
  });
  const missing = contributions.filter((c) => !c.available).map((c) => c.label);
  const sand = contributions.find((c) => c.key === "sand_coverage_pct");
  if (!sand || !sand.available) {
    return { score: null, level: null, contributions, missing,
      explanation: "Not assessed: sand coverage is not available." };
  }
  const usedWeight = contributions.filter((c) => c.available)
    .reduce((sum, c) => sum + CONFIG.DEMO_RULE[c.key].weight, 0);
  const points = contributions.reduce((sum, c) => sum + c.points, 0);
  const score = Math.round(missing.length ? points / usedWeight : points);
  const level = classifyRisk(score);
  contributions.sort((a, b) => b.points - a.points);
  return { score, level, contributions, missing, partial: missing.length > 0,
    explanation: explainIndicator(env, score, level, missing) };
}

// Plain-language reason for the assigned level.
function explainIndicator(env, score, level, missing = []) {
  const s = env.satellite;
  const w = env.weather;
  const band = CONFIG.RISK_BANDS.findIndex((b) => b.level === level);
  const facts = [
    w.wind_speed_mps !== null ? `wind ${w.wind_speed_mps} m/s` : null,
    `sand coverage ${s.sand_coverage_pct}%`,
    s.distance_to_road_m === null ? null
      : env.data_kind === "satellite-derived" ? `nearest sand ${s.distance_to_road_m} m from the road centreline`
      : `sand front ${s.distance_to_road_m} m from the road`,
    s.vegetation_coverage_pct !== null ? `vegetation ${s.vegetation_coverage_pct}%` : null,
  ].filter(Boolean).join(", ");
  if (missing.length) {
    return `${level} (partial score ${score}, band ${describeBandRange(band)}): ${facts}. ` +
      `Not available: ${missing.join(", ").toLowerCase()}, so the score uses only the other inputs (weights rescaled).`;
  }
  const reason = {
    Low: "Sand is far from the road, wind is light and vegetation helps hold the sand.",
    Medium: "Moderate wind and a closer sand front mean sand could reach the road edge.",
    High: "Strong wind, high sand coverage and a sand front right beside the road all point to encroachment.",
  }[level];
  return `${level} (score ${score}, band ${describeBandRange(band)}): ${facts}. ${reason}`;
}
