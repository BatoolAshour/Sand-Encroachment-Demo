/* =====================================================================
 * scenarioData.js — loads the SHARED MOCK DATA used by PRO-01 and PRO-06.
 *
 * Canonical file: data/shared_mock_data.json (v1.0, used UNCHANGED).
 * Values are fixed and illustrative: NOT real sensor readings and NOT
 * validated thresholds. risk_level is a preset display label, NOT a
 * model output. See data/SHARED_MOCK_DATA_README.txt.
 *
 * Contract: every reading has exactly these six fields
 *   timestamp (ISO 8601 UTC) · sensor_id (wind_01 | sand_01) · value (number)
 *   unit (m/s for wind_01, cm for sand_01) · source ("scenario") · status ("ok")
 *
 * This module never changes units, IDs, fields or values. If the file does
 * not match the contract, the dashboard shows the problems instead.
 * ===================================================================== */

const CONTRACT_FIELDS = ["timestamp", "sensor_id", "value", "unit", "source", "status"];
const CONTRACT_UNITS = { wind_01: "m/s", sand_01: "cm" };   // provisional sensor IDs

// Returns a list of problems (empty list = file follows the v1.0 contract).
function validateSharedData(data) {
  const problems = [];
  if (!data || typeof data !== "object") return ["File is not a JSON object."];
  if (data.schema_version !== CONFIG.SHARED_DATA.schemaVersion) {
    problems.push(`schema_version is "${data.schema_version}", dashboard expects "${CONFIG.SHARED_DATA.schemaVersion}".`);
  }
  if (!Array.isArray(data.scenarios)) return [...problems, "Missing scenarios list."];

  data.scenarios.forEach((sc) => {
    const id = sc.scenario_id;
    if (!CONFIG.SCENARIO_ORDER.includes(id)) problems.push(`Unknown scenario_id "${id}".`);
    if (!sc.label || !sc.risk_level) problems.push(`Scenario "${id}" needs label and risk_level.`);
    (sc.readings || []).forEach((r, i) => problems.push(...validateReading(r, `${id} reading ${i + 1}`, "scenario")));
  });
  CONFIG.SCENARIO_ORDER.forEach((id) => {
    if (!data.scenarios.some((sc) => sc.scenario_id === id)) problems.push(`Scenario "${id}" is missing.`);
  });
  return problems;
}

// Checks one reading against the six-field contract.
// expectedSource: "scenario" for the shared file, null to accept any (live).
function validateReading(r, where, expectedSource) {
  const problems = [];
  if (!r || typeof r !== "object") return [`${where}: not an object.`];
  const keys = Object.keys(r).sort().join(",");
  if (keys !== [...CONTRACT_FIELDS].sort().join(",")) problems.push(`${where}: fields must be exactly ${CONTRACT_FIELDS.join(", ")}.`);
  if (!(r.sensor_id in CONTRACT_UNITS)) problems.push(`${where}: unknown sensor_id "${r.sensor_id}".`);
  else if (r.unit !== CONTRACT_UNITS[r.sensor_id]) problems.push(`${where}: ${r.sensor_id} unit must be ${CONTRACT_UNITS[r.sensor_id]}.`);
  if (typeof r.value !== "number" || !Number.isFinite(r.value)) problems.push(`${where}: value must be a number.`);
  if (isNaN(Date.parse(r.timestamp))) problems.push(`${where}: timestamp is not ISO 8601.`);
  if (expectedSource && r.source !== expectedSource) problems.push(`${where}: source must be "${expectedSource}".`);
  if (r.status !== "ok") problems.push(`${where}: status is "${r.status}".`);
  return problems;
}

// { wind_01: reading, sand_01: reading } for quick access by sensor.
function readingsBySensor(readings) {
  const out = {};
  (readings || []).forEach((r) => { out[r.sensor_id] = r; });
  return out;
}

// "medium" → "Medium" for display (the file value itself is never changed).
function displayRisk(riskLevel) {
  return riskLevel ? riskLevel.charAt(0).toUpperCase() + riskLevel.slice(1) : null;
}


/* ---------------------------------------------------------------------
 * SharedFileScenarioProvider — scenarios from data/shared_mock_data.json.
 *
 * load() tries the real JSON file first (works with a local server such as
 * `python3 -m http.server`). When the page is opened by double-click the
 * browser blocks that, so it falls back to js/sharedMockData.js, an exact
 * generated copy (python/sync_shared_data.py keeps them identical).
 * --------------------------------------------------------------------- */
const SharedFileScenarioProvider = {
  data: null,
  origin: null,      // "data/shared_mock_data.json" | "embedded copy (js/sharedMockData.js)"
  problems: [],

  async load() {
    let data = null;
    try {
      const res = await fetch(CONFIG.SHARED_DATA.path, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
      this.origin = CONFIG.SHARED_DATA.path;
    } catch (err) {
      data = typeof SHARED_MOCK_DATA_EMBEDDED !== "undefined" ? SHARED_MOCK_DATA_EMBEDDED : null;
      this.origin = "embedded copy (js/sharedMockData.js)";
    }
    this.problems = validateSharedData(data);
    this.data = this.problems.length ? null : data;
    return this.problems.length === 0;
  },

  list() {
    return this.data ? this.data.scenarios : [];
  },

  // Returns the scenario object exactly as stored in the file.
  async get(scenarioId) {
    return this.list().find((sc) => sc.scenario_id === scenarioId) || null;
  },
};


/* ---------------------------------------------------------------------
 * [PYTHON INTEGRATION POINT — PRO-06]
 * ApiScenarioProvider — the same scenarios served by the Python backend,
 * e.g. GET <CONFIG.SCENARIO_API_BASE>/api/scenarios/<scenario_id>.
 * The endpoint is NOT agreed yet (see SHARED_MOCK_DATA_README.txt). It must
 * return one scenario object in the same shape as the file. Used only when
 * CONFIG.SCENARIO_API_BASE is set; scenario labels still come from the file.
 * --------------------------------------------------------------------- */
const ApiScenarioProvider = {
  async get(scenarioId) {
    const res = await fetch(`${CONFIG.SCENARIO_API_BASE}/api/scenarios/${encodeURIComponent(scenarioId)}`);
    if (!res.ok) throw new Error(`Backend answered HTTP ${res.status}`);
    const sc = await res.json();
    const problems = (sc.readings || []).flatMap((r, i) => validateReading(r, `API reading ${i + 1}`, "scenario"));
    if (sc.scenario_id !== scenarioId) problems.push(`API returned scenario "${sc.scenario_id}".`);
    if (problems.length) throw new Error(problems.join(" "));
    return sc;
  },
};
