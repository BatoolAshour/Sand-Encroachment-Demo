/* =====================================================================
 * config.js — ALL tunable settings live here.
 *
 * Scenario VALUES are not here: they come from data/shared_mock_data.json
 * (shared with PRO-06) and must not be changed in the dashboard.
 * ===================================================================== */

const CONFIG = {
  // While running, the selected scenario's readings are delivered again
  // every TICK_INTERVAL_MS (like polling the future Python API).
  TICK_INTERVAL_MS: 2000,

  /* -------------------------------------------------------------------
   * Shared mock data (PRO-01 + PRO-06). Scenario IDs: low, medium, high.
   * ------------------------------------------------------------------- */
  SHARED_DATA: {
    path: "data/shared_mock_data.json",
    schemaVersion: "1.0",
  },
  SCENARIO_ORDER: ["low", "medium", "high"],
  DEFAULT_SCENARIO: "medium",

  /* -------------------------------------------------------------------
   * [PYTHON INTEGRATION POINT — PRO-06]
   * Base URL of the Python backend that serves the same scenarios, e.g.
   * "http://localhost:5000" → GET /api/scenarios/<scenario_id>.
   * Leave null until the endpoint is agreed and running; the dashboard then
   * reads the shared JSON file directly.
   * ------------------------------------------------------------------- */
  SCENARIO_API_BASE: null,

  /* -------------------------------------------------------------------
   * [PYTHON / ARDUINO INTEGRATION POINT]
   * WebSocket address for Live Sensor Mode (see python/bridge.py).
   * Default: the address python/bridge.py listens on. Live mode shows
   * "Hardware not connected" until the bridge runs, and never invents readings.
   * Set to null to switch Live Sensor Mode off completely.
   * ------------------------------------------------------------------- */
  LIVE_BACKEND_URL: "ws://localhost:8765",   // python/bridge.py default; null = Live mode off

  // Live connection behaviour (never invents readings):
  LIVE_RECONNECT_ATTEMPTS: 3,        // after a lost connection, while running
  LIVE_RECONNECT_DELAY_MS: 2000,
  LIVE_STALE_AFTER_MS: 10000,        // warn when connected but no reading for this long

  /* -------------------------------------------------------------------
   * [SATELLITE INTEGRATION POINT] Satellite Monitoring section.
   * Real Sentinel-2 analyses, kept apart from the prototype's sensors.
   *   - Cached (offline): data/satellite/cache_manifest.js, no server needed.
   *   - Live: python/satellite_server.py at this address
   *     (Copernicus Data Space Ecosystem, or the public AWS archive).
   * ------------------------------------------------------------------- */
  SATELLITE_API_BASE: "http://localhost:8780",
  SATELLITE_DEFAULT_SOURCE: "cache",        // "cache" | "live"
  SATELLITE_REQUEST_TIMEOUT_MS: 180000,     // a live analysis downloads imagery
  SATELLITE_ROAD_BUFFER_M: 200,            // live analysis: extra measurement strip beside the road (10–2000 m)

  // Drawing / gauge scale only: this sand_01 depth fills the road picture.
  SAND_DEPTH_DISPLAY_MAX_CM: 6,

  /* -------------------------------------------------------------------
   * Risk for LIVE readings (scenario mode uses the preset risk_level from
   * the shared file instead). No cm thresholds are agreed yet, so this is
   * null and live risk shows "Not classified". When the team agrees, set:
   *   { lowMax: <cm>, mediumMax: <cm> }   (above mediumMax = High)
   * ------------------------------------------------------------------- */
  SAND_DEPTH_THRESHOLDS_CM: null,

  // Road condition text shown for each risk label.
  ROAD_CONDITION_BY_RISK: {
    Low:    { label: "Light sand at edge", detail: "A thin layer of sand near the road edge." },
    Medium: { label: "Partially covered",  detail: "Sand is spreading onto the lane." },
    High:   { label: "Heavily covered",    detail: "Deep sand covers most of the lane." },
  },

  /* -------------------------------------------------------------------
   * Bands for the 0–100 DEMO indicator score (environmentRule.js).
   * First band whose `max` is not exceeded wins. Prototype values only.
   * ------------------------------------------------------------------- */
  RISK_BANDS: [
    { level: "Low",    max: 30  },   // 0 – 30
    { level: "Medium", max: 60  },   // 31 – 60
    { level: "High",   max: 100 },   // 61 – 100
  ],

  /* -------------------------------------------------------------------
   * Demonstration rule for the field-data indicator (environmentRule.js).
   * ILLUSTRATIVE ONLY: a transparent weighted score, NOT a validated model
   * and NOT the future AI prediction model.
   *
   * Each factor is turned into 0–1 by straight-line scaling between
   * `low` (factor = 0) and `high` (factor = 1). For distance and vegetation
   * `low` is the larger number, because MORE distance / vegetation means
   * LESS risk. Weights must add up to 1. The 0–100 score is then classified
   * with RISK_BANDS. Temperature and humidity are shown but NOT used here.
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
