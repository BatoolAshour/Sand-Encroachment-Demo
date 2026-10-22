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
 *   score: 56,                     0–100
 *   level: "Medium",               via classifyRisk()
 *   contributions: [ { key, label, value, factor, points }, … ]  biggest first
 *   explanation: "…one or two sentences…"
 * }
 */
function assessEnvironmentalIndicator(env) {
  if (!env) return null;
  const contributions = Object.entries(CONFIG.DEMO_RULE).map(([key, rule]) => {
    const value = ruleInputValue(env, key);
    const factor = scaleFactor(value, rule.low, rule.high);
    return { key, label: rule.label, value, factor, points: rule.weight * factor * 100 };
  });
  const score = Math.round(contributions.reduce((sum, c) => sum + c.points, 0));
  const level = classifyRisk(score);
  contributions.sort((a, b) => b.points - a.points);
  return { score, level, contributions, explanation: explainIndicator(env, score, level) };
}

// Plain-language reason for the assigned level.
function explainIndicator(env, score, level) {
  const s = env.satellite;
  const w = env.weather;
  const band = CONFIG.RISK_BANDS.findIndex((b) => b.level === level);
  const facts = `wind ${w.wind_speed_mps} m/s, sand coverage ${s.sand_coverage_pct}%, ` +
    `sand front ${s.distance_to_road_m} m from the road, vegetation ${s.vegetation_coverage_pct}%`;
  const reason = {
    Low: "Sand is far from the road, wind is light and vegetation helps hold the sand.",
    Medium: "Moderate wind and a closer sand front mean sand could reach the road edge.",
    High: "Strong wind, high sand coverage and a sand front right beside the road all point to encroachment.",
  }[level];
  return `${level} (score ${score}, band ${describeBandRange(band)}): ${facts}. ${reason}`;
}
