/* =====================================================================
 * config.js — ALL tunable settings live here.
 *
 * Change thresholds, scenario speeds or the backend URL in this file only.
 * Nothing else in the project needs to be edited for those changes.
 * ===================================================================== */

const CONFIG = {
  // How often a new reading is produced in Scenario Simulation (milliseconds).
  TICK_INTERVAL_MS: 1000,

  /* -------------------------------------------------------------------
   * Risk classification (prototype demonstration thresholds).
   * A sand level is classified by the FIRST band whose `max` it does not
   * exceed. Bands must be sorted from lowest to highest.
   * These are NOT scientifically validated road-safety thresholds.
   * ------------------------------------------------------------------- */
  RISK_BANDS: [
    { level: "Low",    max: 30  },   // 0 – 30 %
    { level: "Medium", max: 60  },   // 31 – 60 %
    { level: "High",   max: 100 },   // 61 – 100 %
  ],

  /* -------------------------------------------------------------------
   * Road condition text shown for each sand level range.
   * Same rule as above: first entry whose `max` is not exceeded wins.
   * ------------------------------------------------------------------- */
  ROAD_CONDITIONS: [
    { max: 10,  label: "Clear",              detail: "No significant sand on the road surface." },
    { max: 30,  label: "Light sand at edge", detail: "Sand is collecting along the road shoulder." },
    { max: 60,  label: "Partially covered",  detail: "Sand is reducing the usable lane width." },
    { max: 85,  label: "Heavily covered",    detail: "Most of the lane is covered with sand." },
    { max: 100, label: "Blocked",            detail: "The road surface is fully covered in the model." },
  ],

  /* -------------------------------------------------------------------
   * Encroachment scenarios for the browser simulation.
   *  rate     : average % of sand added per tick
   *  maxLevel : level at which this scenario stops accumulating
   * Each tick adds rate × a random factor between 0.6 and 1.4,
   * so the curve looks natural but always moves upward.
   * ------------------------------------------------------------------- */
  // Each scenario also has a matching SAMPLE environmental record with the
  // same key in environmentData.js (wind, sand coverage, distance, …).
  SCENARIOS: {
    low:    { label: "Low",    rate: 0.6, maxLevel: 28,  description: "Scenario 1: light wind, sand far from the road, more vegetation." },
    medium: { label: "Medium", rate: 1.2, maxLevel: 58,  description: "Scenario 2: moderate wind, sand front closer to the road." },
    high:   { label: "High",   rate: 2.0, maxLevel: 100, description: "Scenario 3: strong wind, sand right next to the road, little vegetation." },
  },
  DEFAULT_SCENARIO: "medium",

  /* -------------------------------------------------------------------
   * [PYTHON / ARDUINO INTEGRATION POINT]
   * WebSocket address of the future Python backend (see python/bridge.py).
   * Leave as null until the backend exists. While it is null, Live Sensor
   * Mode shows "not configured" and never invents readings.
   * Example when ready:  "ws://localhost:8765"
   * ------------------------------------------------------------------- */
  LIVE_BACKEND_URL: null,

  /* -------------------------------------------------------------------
   * Demonstration rule for the environmental indicator (environmentRule.js).
   * ILLUSTRATIVE ONLY: a transparent weighted score, NOT a validated model
   * and NOT the future AI prediction model.
   *
   * Each factor is turned into 0–1 by straight-line scaling between
   * `low` (factor = 0) and `high` (factor = 1). For distance and vegetation
   * `low` is the larger number, because MORE distance / vegetation means
   * LESS risk. Weights must add up to 1. The 0–100 score is then classified
   * with the same RISK_BANDS as the road sand level.
   * Temperature and humidity are shown for context but are NOT used here.
   * ------------------------------------------------------------------- */
  DEMO_RULE: {
    wind_speed_mps:          { weight: 0.30, low: 3,   high: 12, label: "Wind speed" },
    sand_coverage_pct:       { weight: 0.30, low: 0,   high: 80, label: "Sand coverage" },
    distance_to_road_m:      { weight: 0.25, low: 150, high: 5,  label: "Sand-to-road distance" },
    vegetation_coverage_pct: { weight: 0.15, low: 30,  high: 0,  label: "Low vegetation" },
  },

  // Number of rows shown in the on-screen log table (the CSV keeps all rows).
  LOG_ROWS_VISIBLE: 8,
};
