/* =====================================================================
 * app.js — the "brain" that connects controls, data sources, logging
 * and the dashboard.
 *
 * Flow of one reading:
 *   data source -> handleReading() -> buildSensorData()
 *               -> logger.add()  +  updateDashboard()
 * ===================================================================== */

// ---------- Application state (one place, easy to explain) ----------
const state = {
  mode: "simulation",               // "simulation" | "live"
  status: "reset",                  // "running" | "stopped" | "reset"
  scenario: CONFIG.DEFAULT_SCENARIO,
  runId: 0,                         // increases each time a new run starts after Reset
  elapsedMs: 0,                     // running time of the current run
  runningSince: null,               // Date.now() when the last Start happened
  lastReading: null,                // last raw reading { timestamp, sand_level }
};

const logger = new ExperimentLogger();

const callbacks = {
  onReading: handleReading,
  onConnection: handleConnection,
};
const sources = {
  simulation: new SimulationSource(callbacks),
  live: new LiveSensorSource(callbacks),   // [PYTHON / ARDUINO INTEGRATION POINT]
};
const activeSource = () => sources[state.mode];


// ---------- Building the single data object ----------
function elapsedSeconds() {
  const running = state.runningSince ? Date.now() - state.runningSince : 0;
  return Math.round((state.elapsedMs + running) / 1000);
}

// Combines the latest raw reading with the app state into the agreed format.
function buildSensorData() {
  const r = state.lastReading;
  // Simulation starts from an empty box (0 %). Live mode shows null until a
  // real reading arrives, so nothing is displayed that was not measured.
  const level = r ? r.sand_level : (state.mode === "simulation" ? 0 : null);
  const hasLevel = level !== null;
  return {
    timestamp: r ? r.timestamp : null,
    sand_level: level,
    risk_level: hasLevel ? classifyRisk(level) : null,
    road_condition: hasLevel ? describeRoadCondition(level).label : null,
    mode: state.mode,
    status: state.status,
    scenario: state.mode === "simulation" ? state.scenario : null,
    elapsed_s: elapsedSeconds(),
  };
}

function refresh() {
  updateDashboard(buildSensorData());
  updateControls();
}


// ---------- Callbacks from the data sources ----------
function handleReading(raw) {
  if (state.status !== "running") return; // ignore anything that arrives while stopped
  state.lastReading = raw;
  if (state.mode === "live") showLiveNotice(false); // real data is arriving
  const data = buildSensorData();
  logger.add({ run_id: state.runId, ...data });
  updateDashboard(data);
  renderLog(logger);

  // The simulation stops by itself when the road is fully covered.
  if (state.mode === "simulation" && raw.sand_level >= 100) {
    stopExperiment();
    setHint("Road fully covered. Press Reset to run the experiment again.");
  }
}

function handleConnection(connState, message) {
  if (state.mode !== "live" && connState !== "simulation") return;

  if (connState === "simulation") {
    setConnectionIndicator("simulation", "Simulation: no hardware required");
    return;
  }
  setConnectionIndicator(connState, `Live: ${{
    not_configured: "not configured",
    connecting: "connecting…",
    connected: "Python backend connected",
    disconnected: "not connected",
  }[connState]}`);

  if (connState === "connected") {
    showLiveNotice(!state.lastReading, "Backend connected", message);
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
  if (state.mode === "simulation" && state.lastReading && state.lastReading.sand_level >= 100) {
    setHint("Road is already fully covered. Press Reset first.");
    return;
  }

  const previous = { status: state.status, runId: state.runId };
  if (state.status === "reset") state.runId += 1; // new run after Reset; Stop → Start resumes the same run
  // Status must be "running" before the source sends its first reading.
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
  state.lastReading = null;
  state.elapsedMs = 0;
  state.runningSince = null;
  setHint("");
  if (state.mode === "live") showLiveNoticeForIdleLive();
  refresh();
}

function setMode(mode) {
  if (mode === state.mode) return;
  // Switching mode always resets the current run, so simulated and real
  // values are never mixed on screen. The log keeps all earlier rows.
  resetExperiment();
  state.mode = mode;
  if (mode === "simulation") {
    showLiveNotice(false);
    setConnectionIndicator("simulation", "Simulation: no hardware required");
  } else {
    showLiveNoticeForIdleLive();
  }
  refresh();
}

function showLiveNoticeForIdleLive() {
  if (sources.live.isConfigured()) {
    setConnectionIndicator("disconnected", "Live: not connected");
    showLiveNotice(true, "Hardware not connected",
      `Backend address set to ${CONFIG.LIVE_BACKEND_URL}. Press Start to connect to the Python backend.`);
  } else {
    setConnectionIndicator("not_configured", "Live: not configured");
    showLiveNotice(true, "Hardware not connected",
      "Python/Arduino integration is not configured yet, so no sensor readings are shown.");
  }
}

function setScenario(key) {
  if (!CONFIG.SCENARIOS[key]) return;
  state.scenario = key;
  sources.simulation.setScenario(key); // takes effect on the next tick, even while running
  setHint(CONFIG.SCENARIOS[key].description);
  refresh();
}


// ---------- Keep buttons and toggles in sync with the state ----------
function updateControls() {
  const running = state.status === "running";
  const roadFull = state.mode === "simulation" && state.lastReading && state.lastReading.sand_level >= 100;
  $("btn-start").disabled = running || roadFull;
  $("btn-stop").disabled = !running;
  $("btn-start").innerHTML = state.status === "stopped" ? "&#9654; Resume" : "&#9654; Start";

  document.querySelectorAll("#mode-toggle button").forEach((b) => {
    b.setAttribute("aria-checked", String(b.dataset.mode === state.mode));
  });
  document.querySelectorAll("#scenario-toggle button").forEach((b) => {
    b.setAttribute("aria-checked", String(b.dataset.scenario === state.scenario));
    b.disabled = state.mode !== "simulation";
  });
  $("sim-scenario-note").textContent = state.mode === "simulation"
    ? `Scenario: ${CONFIG.SCENARIOS[state.scenario].label}`
    : "Source: live sensors";
}


// ---------- Wire up the page ----------
document.addEventListener("DOMContentLoaded", () => {
  initDashboard();

  $("btn-start").addEventListener("click", startExperiment);
  $("btn-stop").addEventListener("click", stopExperiment);
  $("btn-reset").addEventListener("click", resetExperiment);

  document.querySelectorAll("#mode-toggle button").forEach((b) =>
    b.addEventListener("click", () => setMode(b.dataset.mode)));
  document.querySelectorAll("#scenario-toggle button").forEach((b) =>
    b.addEventListener("click", () => setScenario(b.dataset.scenario)));

  $("btn-export").addEventListener("click", () => {
    if (!logger.downloadCSV()) setHint("Nothing to export yet.");
  });
  $("btn-clear-log").addEventListener("click", () => {
    logger.clear();
    renderLog(logger);
  });

  // Refresh the elapsed time every second while running (readings may be slower).
  setInterval(() => {
    if (state.status === "running") $("d-elapsed").textContent = formatElapsed(elapsedSeconds());
  }, 1000);

  sources.simulation.setScenario(state.scenario);
  refresh();
  renderLog(logger);
});
