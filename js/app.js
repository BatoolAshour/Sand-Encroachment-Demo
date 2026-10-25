/* =====================================================================
 * app.js — the "brain" that connects controls, data sources, logging
 * and the dashboard.
 *
 * Flow of one delivery:
 *   data source -> handleReading() -> buildSensorData()
 *               -> logger.add() (one row per reading)  +  updateDashboard()
 * ===================================================================== */

// ---------- Application state (one place, easy to explain) ----------
const state = {
  mode: "simulation",               // "simulation" (Scenario / Demo) | "live"
  status: "reset",                  // "running" | "stopped" | "reset"
  scenario: CONFIG.DEFAULT_SCENARIO,
  runId: 0,                         // increases each time a new run starts after Reset
  elapsedMs: 0,                     // running time of the current run
  runningSince: null,               // Date.now() when the last Start happened
  receivedAt: null,                 // when the last readings arrived
  scenarioMeta: null,               // { scenario_id, label, risk_level } of the last delivery
  readings: {},                     // latest contract reading per sensor_id
  environment: null,                // field data record (see environmentData.js)
  envSource: "sample",              // "sample" (scenario) | "satellite" (real Sentinel-2 analysis)
  satelliteEnv: null,               // last Sentinel-2 analysis as a field data record
  dataReady: false,                 // shared mock data loaded and valid
};

// [FUTURE DATA INTEGRATION POINT] swap this for a real provider with the same load().
const environmentProvider = SampleEnvironmentProvider;

const logger = new ExperimentLogger();

const callbacks = {
  onReading: handleReading,
  onConnection: handleConnection,
};
const sources = {
  simulation: new ScenarioSource(callbacks),
  live: new LiveSensorSource(callbacks),   // [PYTHON / ARDUINO INTEGRATION POINT]
};
const activeSource = () => sources[state.mode];


// ---------- Building the single data object ----------
function elapsedSeconds() {
  const running = state.runningSince ? Date.now() - state.runningSince : 0;
  return Math.round((state.elapsedMs + running) / 1000);
}

// Combines the latest readings with the app state into one object.
function buildSensorData() {
  const sand = state.readings.sand_01 || null;
  const wind = state.readings.wind_01 || null;
  const meta = state.scenarioMeta;

  // Scenario mode: the preset label from the file. Live: thresholds (if agreed).
  const riskLevel = meta ? displayRisk(meta.risk_level) : classifySandDepth(sand ? sand.value : null);
  const riskBasis = meta ? "preset label (shared mock data)"
    : riskLevel ? "sand_01 thresholds (config.js)" : null;
  const condition = roadConditionForRisk(riskLevel);

  return {
    received_at: state.receivedAt,
    mode: state.mode,
    status: state.status,
    scenario_id: meta ? meta.scenario_id : null,
    scenario_label: meta ? meta.label : null,
    data_origin: state.mode === "simulation" ? scenarioOrigin() : "live backend",
    readings: Object.values(state.readings),   // contract readings, unchanged
    sand_depth_cm: sand ? sand.value : null,
    wind_speed_mps: wind ? wind.value : null,
    risk_level: riskLevel,
    risk_basis: riskBasis,
    road_condition: condition ? condition.label : null,
    elapsed_s: elapsedSeconds(),
    environment: state.environment,                                  // field data sample, or null
    // Demo rule for the SAMPLE field data only; no score is made from real satellite data.
    environmental_indicator: state.environment && state.environment.data_kind === "sample"
      ? assessEnvironmentalIndicator(state.environment) : null,
  };
}

function scenarioOrigin() {
  if (CONFIG.SCENARIO_API_BASE) return `PRO-06 API (${CONFIG.SCENARIO_API_BASE})`;
  return SharedFileScenarioProvider.origin || "not loaded";
}

// One CSV row per reading: the six contract fields plus run context.
function toLogEntries(data) {
  return data.readings.map((r) => ({
    run_id: state.runId,
    received_at: data.received_at,
    mode: data.mode,
    scenario_id: data.scenario_id || "",
    preset_risk_level: state.scenarioMeta ? state.scenarioMeta.risk_level : "",
    ...r,
  }));
}


// ---------- Field data (sample scenario or real Sentinel-2 analysis) ----------
// Single entry point for environment records from ANY provider
// (sample scenarios, the Sentinel-2 pipeline, later weather data).
function applyEnvironmentData(raw) {
  state.environment = raw ? normalizeEnvironmentData(raw) : null;
  refresh();
}

// Sample data follows the selected scenario. A Sentinel-2 analysis does not:
// it describes a real road, independent of the Low/Medium/High experiment.
function loadScenarioEnvironment() {
  if (state.envSource === "satellite") {
    applyEnvironmentData(state.satelliteEnv);
    return;
  }
  applyEnvironmentData(state.mode === "simulation" ? environmentProvider.load(state.scenario) : null);
}

function setEnvSource(source) {
  if (source === "satellite" && !state.satelliteEnv) return;
  state.envSource = source;
  loadScenarioEnvironment();
}

// Called by the Satellite Monitoring section with each shown analysis.
function handleSatelliteResult(record) {
  state.satelliteEnv = record;
  if (state.envSource === "satellite") loadScenarioEnvironment();
  else updateControls();
}

function refresh() {
  updateDashboard(buildSensorData());
  updateControls();
}


// ---------- Callbacks from the data sources ----------
function handleReading({ received_at, scenario, readings }) {
  if (state.status !== "running") return; // ignore anything that arrives while stopped
  state.receivedAt = received_at;
  state.scenarioMeta = scenario;
  if (scenario) state.readings = {};     // a scenario delivery replaces all readings
  readings.forEach((r) => { state.readings[r.sensor_id] = r; });
  if (state.mode === "live") showLiveNotice(false); // real data is arriving

  const data = buildSensorData();
  toLogEntries({ ...data, readings }).forEach((entry) => logger.add(entry)); // only the new readings
  updateDashboard(data);
  renderLog(logger);
}

function handleConnection(connState, message) {
  if (connState === "simulation") {
    if (state.mode === "simulation") setConnectionIndicator("simulation", "Scenario / Demo: no hardware required");
    return;
  }
  if (connState === "api_error") {
    setConnectionIndicator("disconnected", "Scenario API: error");
    if (state.status === "running") stopExperiment();
    setHint(message);
    return;
  }
  if (state.mode !== "live") return;

  if (connState === "stale") {
    // Still connected, but the Arduino has gone quiet: keep the last values, warn clearly.
    setConnectionIndicator("connecting", "Live: connected, no readings");
    setHint(message);
    return;
  }

  setConnectionIndicator(connState, `Live: ${{
    not_configured: "not configured",
    connecting: "connecting…",
    connected: "Python backend connected",
    disconnected: "not connected",
  }[connState]}`);

  if (connState === "connected") {
    showLiveNotice(Object.keys(state.readings).length === 0, "Backend connected", message);
    setHint("");
  } else if (connState === "connecting") {
    showLiveNotice(true, "Connecting…", message);
  } else {
    showLiveNotice(true, "Hardware not connected", message);
    // Losing the connection while running: stop honestly, keep last values.
    if (connState === "disconnected") {
      if (state.status === "running") stopExperiment();
      setHint(message);
    }
  }
}


// ---------- Control actions ----------
function startExperiment() {
  if (state.status === "running") return;
  if (state.mode === "simulation" && !state.dataReady) {
    setHint("Shared mock data is not loaded, so there is nothing to play.");
    return;
  }

  const previous = { status: state.status, runId: state.runId };
  if (state.status === "reset") state.runId += 1; // new run after Reset; Stop → Start resumes the same run
  // Status must be "running" before the source sends its first readings.
  state.status = "running";
  state.runningSince = Date.now();
  setHint("");

  if (!activeSource().start()) {
    // Live mode without a configured backend: nothing starts, nothing is invented.
    state.status = previous.status;
    state.runId = previous.runId;
    state.runningSince = null;
    setHint("Cannot start Live Sensor Mode: Python/Arduino integration is not configured yet.");
  }
  refresh();
}

function stopExperiment() {
  if (state.status !== "running") return;
  activeSource().stop();
  state.elapsedMs += Date.now() - state.runningSince;
  state.runningSince = null;
  state.status = "stopped";
  refresh();
}

function resetExperiment() {
  activeSource().reset();
  state.status = "reset";
  state.readings = {};
  state.scenarioMeta = null;
  state.receivedAt = null;
  state.elapsedMs = 0;
  state.runningSince = null;
  setHint("");
  if (state.mode === "live") showLiveNoticeForIdleLive();
  refresh();
}

function setMode(mode) {
  if (mode === state.mode) return;
  // Switching mode always resets the current run, so scenario and real
  // values are never mixed on screen. The log keeps all earlier rows.
  resetExperiment();
  state.mode = mode;
  if (mode === "simulation") {
    showLiveNotice(false);
    setConnectionIndicator("simulation", "Scenario / Demo: no hardware required");
  } else {
    showLiveNoticeForIdleLive();
  }
  // Field data sample belongs to Scenario / Demo only; live mode has no source yet.
  loadScenarioEnvironment();
}

function showLiveNoticeForIdleLive() {
  if (sources.live.isConfigured()) {
    setConnectionIndicator("disconnected", "Live: not connected");
    showLiveNotice(true, "Hardware not connected",
      `Waiting for the Arduino. Run python/bridge.py (address ${CONFIG.LIVE_BACKEND_URL}), then press Start. No readings are shown until real data arrives.`);
  } else {
    setConnectionIndicator("not_configured", "Live: not configured");
    showLiveNotice(true, "Hardware not connected",
      "Python/Arduino integration is not configured yet, so no sensor readings are shown.");
  }
}

function setScenario(id) {
  if (!CONFIG.SCENARIO_ORDER.includes(id)) return;
  state.scenario = id;
  sources.simulation.setScenario(id); // next delivery uses it, even while running
  setHint(scenarioSummary(id));
  if (state.status === "running") sources.simulation.tick(); // show the new scenario at once
  loadScenarioEnvironment(); // field data, road strip and demo indicator update together
}

// "Scenario / Demo · Medium: wind_01 6 m/s, sand_01 2.5 cm, preset risk medium"
function scenarioSummary(id) {
  const sc = SharedFileScenarioProvider.list().find((s) => s.scenario_id === id);
  if (!sc) return "";
  const r = readingsBySensor(sc.readings);
  const parts = Object.values(r).map((x) => `${x.sensor_id} ${x.value} ${x.unit}`).join(", ");
  const next = state.status === "running" ? "" : " Press Start to play it.";
  return `Scenario / Demo · ${sc.label}: ${parts}, preset risk "${sc.risk_level}".${next}`;
}


// ---------- Keep buttons and toggles in sync with the state ----------
function updateControls() {
  const running = state.status === "running";
  $("btn-start").disabled = running || (state.mode === "simulation" && !state.dataReady);
  $("btn-stop").disabled = !running;
  $("btn-start").innerHTML = state.status === "stopped" ? "&#9654; Resume" : "&#9654; Start";

  document.querySelectorAll("#mode-toggle button").forEach((b) => {
    b.setAttribute("aria-checked", String(b.dataset.mode === state.mode));
  });
  document.querySelectorAll("#scenario-toggle button").forEach((b) => {
    b.setAttribute("aria-checked", String(b.dataset.scenario === state.scenario));
    b.disabled = state.mode !== "simulation" || !state.dataReady;
  });
  document.querySelectorAll("#env-source-toggle button").forEach((b) => {
    b.setAttribute("aria-checked", String(b.dataset.envSource === state.envSource));
    if (b.dataset.envSource === "satellite") b.disabled = !state.satelliteEnv;
  });
  const sc = SharedFileScenarioProvider.list().find((s) => s.scenario_id === state.scenario);
  $("sim-scenario-note").textContent = state.mode === "simulation"
    ? `Scenario / Demo: ${sc ? sc.label : "—"}`
    : "Source: live sensors";
}


// ---------- Wire up the page ----------
// Each part is wired on its own (startStep), so a failure in one optional
// part (e.g. the satellite section, or a file the browser served from an old
// cache) can never leave the core experiment controls without listeners.
function startStep(name, fn) {
  try {
    fn();
    return true;
  } catch (err) {
    console.error(`Dashboard start-up: ${name} failed`, err);
    reportStartupProblem(`${name} could not start (${err.message}).`);
    return false;
  }
}

function wireExperimentControls() {
  $("btn-start").addEventListener("click", startExperiment);
  $("btn-stop").addEventListener("click", stopExperiment);
  $("btn-reset").addEventListener("click", resetExperiment);
  document.querySelectorAll("#mode-toggle button").forEach((b) =>
    b.addEventListener("click", () => setMode(b.dataset.mode)));
  document.querySelectorAll("#scenario-toggle button").forEach((b) =>
    b.addEventListener("click", () => setScenario(b.dataset.scenario)));
}

function wireLogControls() {
  $("btn-export").addEventListener("click", () => {
    if (!logger.downloadCSV()) setHint("Nothing to export yet.");
  });
  $("btn-clear-log").addEventListener("click", () => {
    logger.clear();
    renderLog(logger);
  });
}

// Satellite Monitoring is optional: without it the rest of the page still works.
function startSatelliteMonitoring() {
  document.querySelectorAll("#env-source-toggle button").forEach((b) =>
    b.addEventListener("click", () => setEnvSource(b.dataset.envSource)));
  const use = $("btn-sat-use");
  if (use) {
    use.addEventListener("click", () => {
      setEnvSource("satellite");
      $("env-title").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  SatelliteMonitor.init({ onResult: handleSatelliteResult });
}

document.addEventListener("DOMContentLoaded", async () => {
  startStep("Road drawing", initDashboard);
  startStep("Experiment controls", wireExperimentControls);
  startStep("Experiment log", wireLogControls);

  // Refresh the elapsed time every second while running (readings may be slower).
  setInterval(() => {
    if (state.status === "running") $("d-elapsed").textContent = formatElapsed(elapsedSeconds());
  }, 1000);

  // Load the shared mock data before anything can be played.
  try {
    state.dataReady = await SharedFileScenarioProvider.load();
  } catch (err) {
    console.error("Shared mock data could not be loaded", err);
    state.dataReady = false;
  }
  startStep("Data status", () => {
    showDataStatus(SharedFileScenarioProvider);
    if (state.dataReady) {
      labelScenarioButtons(SharedFileScenarioProvider.list());
      setHint(scenarioSummary(state.scenario));
    }
  });

  sources.simulation.setScenario(state.scenario);
  startStep("Field data", loadScenarioEnvironment);
  startStep("Experiment log", () => renderLog(logger));

  // Real Sentinel-2 section: shows the cached analyses at once (no network).
  startStep("Satellite monitoring", startSatelliteMonitoring);
  startStep("Controls", refresh);   // buttons reflect the final state even if a step above failed
});
