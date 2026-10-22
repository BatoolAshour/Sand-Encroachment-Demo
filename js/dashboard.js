/* =====================================================================
 * dashboard.js — everything that DRAWS the page.
 *
 * The key function is updateDashboard(sensorData): every visible reading
 * (road picture, sand level, gauge, risk, road condition, status, mode,
 * data panel) is refreshed from that ONE data object. It does not matter
 * whether the object came from the simulation or from real sensors.
 *
 * sensorData format (see data/sample_reading.json):
 * {
 *   "timestamp":      "2026-10-22T12:00:00.000Z",
 *   "sand_level":     45,          // 0–100, or null when there is no data
 *   "risk_level":     "Medium",    // "Low" | "Medium" | "High" | null
 *   "road_condition": "Partially covered",
 *   "mode":           "simulation",// "simulation" | "live"
 *   "status":         "running",   // "running" | "stopped" | "reset"
 *   "scenario":       "medium",    // simulation only, else null
 *   "elapsed_s":      12,
 *   "environment":    { satellite, weather, … } or null   (environmentData.js)
 *   "environmental_indicator": { score, level, … } or null (environmentRule.js)
 * }
 * ===================================================================== */

const $ = (id) => document.getElementById(id);

const MODE_LABELS = { simulation: "Scenario Simulation", live: "Live Sensor" };
const STATUS_LABELS = { running: "Running", stopped: "Stopped", reset: "Reset" };

// Road geometry inside the SVG (must match index.html).
const ROAD_TOP = 120;
const ROAD_HEIGHT = 130;

// Called once on page load: builds the gauge marks and legend from config.
function initDashboard() {
  const gauge = $("gauge");
  const legend = $("gauge-legend");
  CONFIG.RISK_BANDS.forEach((band, i) => {
    if (i < CONFIG.RISK_BANDS.length - 1) {
      const mark = document.createElement("span");
      mark.className = "gauge-mark";
      mark.style.left = `${band.max}%`;
      gauge.appendChild(mark);
    }
    const item = document.createElement("span");
    item.innerHTML = `<i class="swatch" data-level="${band.level}"></i>${band.level} ${describeBandRange(i)}`;
    legend.appendChild(item);
  });
}

/* ---------------------------------------------------------------------
 * updateDashboard — single entry point for all readings.
 * --------------------------------------------------------------------- */
function updateDashboard(sensorData) {
  const hasData = typeof sensorData.sand_level === "number";
  const level = hasData ? sensorData.sand_level : 0;
  const risk = hasData ? sensorData.risk_level : null;

  // 1) Road picture
  drawSandOnRoad(level);
  $("svg-coverage").textContent = hasData ? `${Math.round(level)}%` : "no data";
  document.querySelectorAll("#sensors .sensor").forEach((sensor) => {
    sensor.classList.toggle("covered", hasData && level >= Number(sensor.dataset.depth));
  });
  $("wind").classList.toggle("active", sensorData.status === "running" && sensorData.mode === "simulation");

  // 2) Sand level + gauge
  $("sand-value").textContent = hasData ? level.toFixed(1) : "--";
  const fill = $("gauge-fill");
  fill.style.width = `${level}%`;
  fill.dataset.level = risk || "";

  // 3) Risk indicator
  document.querySelectorAll("#risk-pills .risk-pill").forEach((pill) => {
    pill.classList.toggle("active", pill.dataset.level === risk);
  });
  $("risk-message").textContent = riskMessage(sensorData, hasData);
  $("risk-message").dataset.level = risk || "";

  // 4) Road condition
  const condition = hasData ? describeRoadCondition(level) : null;
  $("road-condition").textContent = condition ? condition.label : "Unknown";
  $("road-condition-detail").textContent = condition
    ? condition.detail
    : "No sensor data available.";

  // 5) Status + mode
  const badge = $("status-badge");
  badge.dataset.status = sensorData.status;
  badge.textContent = STATUS_LABELS[sensorData.status];

  // 6) Compact live data panel
  $("d-timestamp").textContent = sensorData.timestamp ? formatTime(sensorData.timestamp) : "—";
  $("d-sand").textContent = hasData ? `${level.toFixed(1)} %` : "—";
  $("d-risk").textContent = risk || "—";
  $("d-risk").dataset.level = risk || "";
  $("d-mode").textContent = MODE_LABELS[sensorData.mode];
  $("d-status").textContent = STATUS_LABELS[sensorData.status];
  $("d-elapsed").textContent = formatElapsed(sensorData.elapsed_s || 0);
  $("d-envsource").textContent = sensorData.environment
    ? `${sensorData.environment.data_source} (${sensorData.environment.satellite.observation_date})`
    : "none connected";
  $("d-json").textContent = JSON.stringify(sensorData, (key, value) =>
    key === "contributions" ? undefined : value, 2); // keep the JSON view short

  // 7) Environmental & satellite section + the strip above the road
  renderEnvironment(sensorData.environment, sensorData.environmental_indicator);
  drawStrip(sensorData.environment);
}

/* ---------------------------------------------------------------------
 * Environmental & satellite panel (sample data today).
 * --------------------------------------------------------------------- */
function renderEnvironment(env, indicator) {
  $("env-empty").hidden = !!env;
  $("env-grid").classList.toggle("is-empty", !env);
  const set = (id, text) => { $(id).textContent = text; };
  const bar = (id, pct) => { $(id).style.width = env ? `${pct}%` : "0"; };

  if (!env) {
    ["e-temp", "e-hum", "e-wind", "e-sand", "e-veg", "e-bare", "e-dist", "e-score", "e-level"]
      .forEach((id) => set(id, "—"));
    set("e-source", "");
    set("e-meta", "No data source connected.");
    set("e-explain", "No environmental data available.");
    $("e-level").dataset.level = "";
    $("e-contrib").innerHTML = "";
    ["e-sand-bar", "e-veg-bar", "e-bare-bar"].forEach((id) => bar(id, 0));
    return;
  }

  const s = env.satellite;
  const w = env.weather;
  set("e-temp", w.temperature_c);
  set("e-hum", w.humidity_pct);
  set("e-wind", w.wind_speed_mps.toFixed(1));
  set("e-sand", `${s.sand_coverage_pct}%`);
  set("e-veg", `${s.vegetation_coverage_pct}%`);
  set("e-bare", `${s.bare_soil_pct}%`);
  bar("e-sand-bar", s.sand_coverage_pct);
  bar("e-veg-bar", s.vegetation_coverage_pct);
  bar("e-bare-bar", s.bare_soil_pct);
  set("e-dist", s.distance_to_road_m);
  set("e-source", `· ${s.source}`);
  set("e-meta", `Observation ${s.observation_date} · ${s.buffer_m} m strip beside the road · ${env.location}`);

  set("e-score", indicator.score);
  set("e-level", indicator.level);
  $("e-level").dataset.level = indicator.level;
  set("e-explain", indicator.explanation);
  // Small bars: how many of the 100 points each variable contributes.
  $("e-contrib").innerHTML = indicator.contributions.map((c) => {
    const max = CONFIG.DEMO_RULE[c.key].weight * 100;
    return `<li><span>${c.label}</span>
      <div class="bar"><i style="width:${(c.points / max) * 100}%"></i></div>
      <b>${c.points.toFixed(0)}/${max}</b></li>`;
  }).join("");
}

/* ---------------------------------------------------------------------
 * The strip above the road in the SVG, drawn from the satellite sample:
 *   sand field edge  → distance_to_road_m (closer = lower edge)
 *   number of shrubs → vegetation_coverage_pct
 *   wind arrow speed → wind_speed_mps
 * Not to scale: 150 m or more is drawn as the top of the strip.
 * --------------------------------------------------------------------- */
const SHRUB_SLOTS = [
  [205, 0.85], [110, 0.3], [170, 0.6], [240, 0.45], [300, 0.65], [360, 0.35],
  [430, 0.7], [490, 0.4], [560, 0.6], [620, 0.5], [650, 0.25], [780, 0.7],
];

function drawStrip(env) {
  const edgeY = env ? 118 - (Math.min(env.satellite.distance_to_road_m, 150) / 150) * 100 : 60;

  // Sand field from the top of the box down to its front edge (wavy).
  const pts = [];
  for (let x = 800; x >= 0; x -= 20) {
    const y = edgeY + 5 * Math.sin(x / 45) + 3 * Math.sin(x / 17 + 2);
    pts.push(`L${x},${Math.min(118, Math.max(2, y)).toFixed(1)}`);
  }
  $("sand-field").setAttribute("d", `M0,0 L800,0 ${pts.join(" ")} Z`);

  // Shrubs between the sand front and the road.
  const shrubs = env ? Math.min(SHRUB_SLOTS.length,
    Math.round((env.satellite.vegetation_coverage_pct / 25) * SHRUB_SLOTS.length)) : 0;
  $("shrubs").innerHTML = SHRUB_SLOTS.slice(0, shrubs).map(([x, f]) => {
    const y = edgeY + (118 - edgeY) * f;
    return `<circle cx="${x}" cy="${y.toFixed(1)}" r="6" class="shrub"/>`;
  }).join("");

  // Distance marker from the sand front to the road edge.
  const marker = $("distance-marker");
  marker.style.display = env ? "" : "none";
  if (env) {
    $("distance-line").setAttribute("y1", edgeY.toFixed(1));
    const label = $("distance-label");
    label.textContent = `${env.satellite.distance_to_road_m} m`;
    label.setAttribute("y", Math.min(112, Math.max(16, (edgeY + 118) / 2 + 5)).toFixed(1));
  }

  // Faster arrows for stronger wind (only animated while running).
  const wind = env ? env.weather.wind_speed_mps : 5;
  $("wind").style.setProperty("--wind-duration", `${Math.max(0.25, 3 / wind).toFixed(2)}s`);
  $("wind-label").textContent = env ? `Wind ${wind.toFixed(1)} m/s (sample)` : "Wind";
  $("svg-source-note").textContent = env
    ? "Strip above road: sample satellite data"
    : "Strip above road: no data source";
}

function riskMessage(data, hasData) {
  if (!hasData) return "No live sensor data.";
  if (!data.timestamp) return "Waiting for the experiment to start.";
  const pct = `${Math.round(data.sand_level)}%`;
  switch (data.risk_level) {
    case "Low":    return `Sand mostly off the road (${pct} coverage).`;
    case "Medium": return `Sand reaching the lane: ${pct} coverage.`;
    case "High":   return `Road heavily affected: ${pct} coverage.`;
    default:       return "";
  }
}

// Draws the sand layer on the road. 0 % = no sand, 100 % = whole road covered.
// The wavy edge uses fixed sine waves, so the shape does not flicker.
function drawSandOnRoad(level) {
  const path = $("sand-on-road");
  if (level <= 0) {
    path.setAttribute("d", "");
    return;
  }
  const depth = (level / 100) * ROAD_HEIGHT;
  const wave = Math.min(10, depth / 3, ROAD_HEIGHT - depth); // flat when fully covered
  const points = [];
  for (let x = 800; x >= 0; x -= 20) {
    const y = ROAD_TOP + depth
      + wave * Math.sin(x / 60)
      + (wave / 2) * Math.sin(x / 23 + 1);
    points.push(`L${x},${Math.min(ROAD_TOP + ROAD_HEIGHT, Math.max(ROAD_TOP, y)).toFixed(1)}`);
  }
  path.setAttribute("d", `M0,${ROAD_TOP} L800,${ROAD_TOP} ${points.join(" ")} Z`);
}

// Header indicator: where the data is coming from right now.
function setConnectionIndicator(state, text) {
  $("connection").dataset.state = state;
  $("connection-text").textContent = text;
}

function showLiveNotice(visible, title, text) {
  $("live-notice").hidden = !visible;
  if (title) $("live-notice-title").textContent = title;
  if (text) $("live-notice-text").textContent = text;
}

function setHint(text) {
  $("hint").textContent = text || "";
}

function renderLog(logger) {
  $("log-count").textContent = `(${logger.count} reading${logger.count === 1 ? "" : "s"})`;
  $("btn-export").disabled = logger.count === 0;
  $("btn-clear-log").disabled = logger.count === 0;

  const body = $("log-body");
  if (logger.count === 0) {
    body.innerHTML = '<tr class="empty"><td colspan="6">No readings yet. Press Start to record data.</td></tr>';
    return;
  }
  body.innerHTML = logger.latest(CONFIG.LOG_ROWS_VISIBLE).map((e) => `
    <tr>
      <td>#${e.run_id}</td>
      <td>${formatTime(e.timestamp)}</td>
      <td>${MODE_LABELS[e.mode]}</td>
      <td>${e.scenario ? CONFIG.SCENARIOS[e.scenario].label : "—"}</td>
      <td>${e.sand_level.toFixed(1)}</td>
      <td><span class="tag" data-level="${e.risk_level}">${e.risk_level}</span></td>
    </tr>`).join("");
}

function formatTime(iso) {
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleTimeString([], { hour12: false });
}

function formatElapsed(seconds) {
  const s = Math.floor(seconds);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
