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
  SCENARIOS: {
    low:    { label: "Low",    rate: 0.6, maxLevel: 28,  description: "Light wind: sand settles slowly at the road edge." },
    medium: { label: "Medium", rate: 1.2, maxLevel: 58,  description: "Moderate wind: sand spreads onto the lane." },
    high:   { label: "High",   rate: 2.0, maxLevel: 100, description: "Strong wind: sand can cover the whole road." },
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

  // Number of rows shown in the on-screen log table (the CSV keeps all rows).
  LOG_ROWS_VISIBLE: 8,
};
