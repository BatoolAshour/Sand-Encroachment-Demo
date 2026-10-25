/* =====================================================================
 * dashboard.js — everything that DRAWS the page.
 *
 * The key function is updateDashboard(sensorData): every visible reading
 * (road picture, sand depth, wind, risk, road condition, status, mode,
 * data panel, field data) is refreshed from that ONE data object. It does
 * not matter whether it came from the shared scenario file, the future
 * PRO-06 API or real sensors.
 *
 * sensorData format (see data/sample_reading.json):
 * {
 *   "received_at":    "2026-10-23T11:00:00.000Z",  // when the readings arrived
 *   "mode":           "simulation",  // "simulation" (Scenario / Demo) | "live"
 *   "status":         "running",     // "running" | "stopped" | "reset"
 *   "scenario_id":    "medium",      // null in live mode
 *   "scenario_label": "Medium",
 *   "data_origin":    "data/shared_mock_data.json",
 *   "readings":       [ six-field contract readings, unchanged ],
 *   "sand_depth_cm":  2.5,           // sand_01 value, or null
 *   "wind_speed_mps": 6.0,           // wind_01 value, or null
 *   "risk_level":     "Medium",      // preset label (scenario) or null
 *   "risk_basis":     "preset label (shared mock data)",
 *   "road_condition": "Partially covered",
 *   "elapsed_s":      12,
 *   "environment":    { satellite, weather, … } or null   (environmentData.js)
 *   "environmental_indicator": { score, level, … } or null (environmentRule.js)
 * }
 * ===================================================================== */

const $ = (id) => document.getElementById(id);

const MODE_LABELS = { simulation: "Scenario / Demo", live: "Live Sensor" };
const STATUS_LABELS = { running: "Running", stopped: "Stopped", reset: "Reset" };

// Road geometry inside the SVG (must match index.html).
const ROAD_TOP = 120;
const ROAD_HEIGHT = 130;

function initDashboard() {
  drawSandOnRoad(0);
}

// Start-up problems are shown on the page (not only in the console), so a
// broken part is visible instead of the page silently not responding.
function reportStartupProblem(text) {
  const box = $("startup-problem");
  if (!box) return;
  box.hidden = false;
  box.textContent = box.textContent ? `${box.textContent} ${text}` : `Start-up problem: ${text} ` +
    "If you updated the files, reload with Cmd+Shift+R (Ctrl+F5) so the browser drops old cached copies.";
}

// After loading: show which shared file is used, or list its problems.
function showDataStatus(provider) {
  const box = $("data-status");
  if (provider.problems.length) {
    box.dataset.state = "error";
    box.innerHTML = `<strong>Shared mock data could not be used</strong> (nothing was changed or guessed):
      <ul>${provider.problems.map((p) => `<li>${p}</li>`).join("")}</ul>`;
    return;
  }
  const d = provider.data;
  box.dataset.state = "ok";
  box.innerHTML = `<strong>Scenario / Demo data:</strong> ${d.dataset_id} · schema v${d.schema_version} ·
    loaded from <code>${provider.origin}</code> · fixed illustrative values, not real sensor readings`;
}

// Scenario buttons + depth gauge marks use the labels and values from the file.
function labelScenarioButtons(scenarios) {
  scenarios.forEach((sc) => {
    const btn = document.querySelector(`#scenario-toggle [data-scenario="${sc.scenario_id}"]`);
    if (btn) btn.textContent = sc.label;
  });
  const gauge = $("gauge");
  const legend = $("gauge-legend");
  gauge.querySelectorAll(".gauge-mark").forEach((m) => m.remove());
  legend.innerHTML = "";
  scenarios.forEach((sc) => {
    const sand = readingsBySensor(sc.readings).sand_01;
    if (!sand) return;
    const mark = document.createElement("span");
    mark.className = "gauge-mark";
    mark.style.left = `${depthFraction(sand.value) * 100}%`;
    gauge.appendChild(mark);
    const item = document.createElement("span");
    item.innerHTML = `<i class="swatch" data-level="${displayRisk(sc.risk_level)}"></i>${sc.label} ${sand.value} cm`;
    legend.appendChild(item);
  });
}

// sand_01 depth → 0–1 share of the drawing / gauge (display scale only).
function depthFraction(cm) {
  return Math.min(1, Math.max(0, (cm || 0) / CONFIG.SAND_DEPTH_DISPLAY_MAX_CM));
}

/* ---------------------------------------------------------------------
 * updateDashboard — single entry point for all readings.
 * --------------------------------------------------------------------- */
function updateDashboard(sensorData) {
  const sand = sensorData.sand_depth_cm;
  const wind = sensorData.wind_speed_mps;
  const hasSand = typeof sand === "number";
  const risk = sensorData.risk_level;

  // 1) Road picture (the drawing eases to the new depth; numbers are exact)
  animateRoadTo(hasSand ? depthFraction(sand) : 0);
  $("svg-coverage").textContent = hasSand ? `${sand} cm` : "—";
  $("sensor-sand").classList.toggle("covered", hasSand && sand > 0);
  $("sensor-wind").classList.toggle("covered", typeof wind === "number");
  $("wind").classList.toggle("active", sensorData.status === "running" && typeof wind === "number");

  // 2) Sensor readings + gauge
  $("sand-value").textContent = hasSand ? sand : "--";
  $("wind-value").textContent = typeof wind === "number" ? wind : "--";
  const fill = $("gauge-fill");
  fill.style.width = `${depthFraction(hasSand ? sand : 0) * 100}%`;
  fill.dataset.level = risk || "";

  // 3) Risk indicator
  document.querySelectorAll("#risk-pills .risk-pill").forEach((pill) => {
    pill.classList.toggle("active", pill.dataset.level === risk);
  });
  $("risk-basis").textContent = sensorData.mode === "live"
    ? "(sand_01 thresholds)" : "(preset scenario label)";
  $("risk-message").textContent = riskMessage(sensorData);
  $("risk-message").dataset.level = risk || "";

  // 4) Road condition (follows the risk label)
  const condition = roadConditionForRisk(risk);
  $("road-condition").textContent = condition ? condition.label : "—";
  $("road-condition-detail").textContent = condition ? condition.detail
    : sensorData.mode === "live" && hasSand ? "Not classified: no sand_01 thresholds agreed yet."
    : "Press Start to play the selected scenario.";

  // 5) Status
  const badge = $("status-badge");
  badge.dataset.status = sensorData.status;
  badge.textContent = STATUS_LABELS[sensorData.status];

  // 6) Compact live data panel
  $("d-timestamp").textContent = sensorData.received_at ? formatTime(sensorData.received_at) : "—";
  $("d-scenario").textContent = sensorData.scenario_label ? `${sensorData.scenario_label} (${sensorData.scenario_id})` : "—";
  $("d-risk").textContent = risk || (hasSand ? "Not classified" : "—");
  $("d-risk").dataset.level = risk || "";
  $("d-mode").textContent = MODE_LABELS[sensorData.mode];
  $("d-status").textContent = STATUS_LABELS[sensorData.status];
  $("d-elapsed").textContent = formatElapsed(sensorData.elapsed_s || 0);
  $("d-origin").textContent = sensorData.data_origin || "—";
  $("d-envsource").textContent = sensorData.environment
    ? `${sensorData.environment.data_source} (${sensorData.environment.satellite.observation_date})`
    : "none connected";
  renderReadingsTable(sensorData.readings);
  $("d-json").textContent = JSON.stringify(sensorData, (key, value) =>
    key === "contributions" ? undefined : value, 2); // keep the JSON view short

  // 7) Field data section + the strip above the road
  renderEnvironment(sensorData.environment, sensorData.environmental_indicator);
  drawStrip(sensorData.environment);

  // 8) Wind arrows follow wind_01 when there is a reading
  if (typeof wind === "number") {
    $("wind").style.setProperty("--wind-duration", `${Math.max(0.25, 3 / Math.max(wind, 0.5)).toFixed(2)}s`);
    $("wind-label").textContent = `wind_01 ${wind} m/s`;
  }
}

function renderReadingsTable(readings) {
  const body = $("d-readings");
  if (!readings || readings.length === 0) {
    body.innerHTML = '<tr class="empty"><td colspan="6">No readings yet.</td></tr>';
    return;
  }
  body.innerHTML = readings.map((r) => `
    <tr><td>${r.sensor_id}</td><td>${r.value}</td><td>${r.unit}</td>
        <td>${r.source}</td><td>${r.status}</td><td>${r.timestamp}</td></tr>`).join("");
}

/* ---------------------------------------------------------------------
 * Environmental & satellite panel: sample data, or a real Sentinel-2
 * analysis (js/satellite.js). Missing values are shown as "—".
 * --------------------------------------------------------------------- */
const ENV_HEADINGS = {
  sample: {
    title: "Field data sample", note: "satellite + weather, future real-world inputs",
    badge: "Sample data · not real sensor or satellite measurements",
  },
  "satellite-derived": {
    title: "Field data", note: "Sentinel-2 analysis of a real road segment",
    badge: "Real Sentinel-2 data · satellite-derived, not from the prototype",
  },
};

// Sets text only if the element exists (keeps rendering alive if the page
// and the scripts ever come from different versions).
function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function renderEnvHeading(kind) {
  const h = ENV_HEADINGS[kind] || ENV_HEADINGS.sample;
  setText("env-title-text", h.title);
  setText("env-title-note", h.note);
  setText("env-badge", h.badge);
  if ($("env-badge")) $("env-badge").dataset.kind = kind === "satellite-derived" ? "satellite" : "sample";
}

function renderEnvironment(env, indicator) {
  $("env-empty").hidden = !!env;
  $("env-grid").classList.toggle("is-empty", !env);
  const set = setText;
  const show = (v) => (v === null || v === undefined ? "—" : v);
  const pct = (v) => (v === null || v === undefined ? "—" : `${v}%`);
  const bar = (id, v) => { $(id).style.width = env && v !== null ? `${v}%` : "0"; };
  if (env) renderEnvHeading(env.data_kind);

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
  const real = env.data_kind === "satellite-derived";
  set("e-temp", show(w.temperature_c));
  set("e-hum", show(w.humidity_pct));
  set("e-wind", w.wind_speed_mps === null ? "—" : w.wind_speed_mps.toFixed(1));
  set("e-weather-note", real
    ? `Not available: ${env.weather_note || "no weather source connected."} The prototype's wind_01 sensor is not used here.`
    : "Field weather for a real corridor, separate from the prototype's wind_01 sensor. Temperature and humidity are context only; the demo rule does not use them.");
  set("e-sand", pct(s.sand_coverage_pct));
  set("e-veg", pct(s.vegetation_coverage_pct));
  set("e-bare", pct(s.bare_soil_pct));
  bar("e-sand-bar", s.sand_coverage_pct);
  bar("e-veg-bar", s.vegetation_coverage_pct);
  bar("e-bare-bar", s.bare_soil_pct);
  set("e-dist", show(s.distance_to_road_m));
  set("e-dist-label", real ? "Nearest sand to road centreline" : "Sand front to road");
  set("e-source", `· ${s.source}`);
  set("e-meta", real
    ? `Scene ${s.scene_id || ""} · ${s.observation_date} · ${s.coverage_basis} · ${env.location}` +
      (s.distance_to_road_m === null ? ` · Distance not computed: ${s.distance_note}.` : " · Distance from road centreline.")
    : `Observation ${s.observation_date} · ${s.buffer_m} m strip beside the road · ${env.location}`);

  set("e-score", show(indicator.score));
  set("e-level", indicator.level ? (indicator.partial ? `${indicator.level} (partial)` : indicator.level) : "—");
  $("e-level").dataset.level = indicator.level || "";
  set("e-explain", indicator.explanation);
  // Small bars: how many of the 100 points each variable contributes.
  $("e-contrib").innerHTML = indicator.contributions.map((c) => {
    const max = CONFIG.DEMO_RULE[c.key].weight * 100;
    return `<li><span>${c.label}</span>
      <div class="bar"><i style="width:${(c.points / max) * 100}%"></i></div>
      <b>${c.available ? `${c.points.toFixed(0)}/${max}` : "n/a"}</b></li>`;
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
  const dist = env ? env.satellite.distance_to_road_m : null;
  const edgeY = dist !== null ? 118 - (Math.min(dist, 150) / 150) * 100 : 60;

  // Sand field from the top of the box down to its front edge (wavy).
  const pts = [];
  for (let x = 800; x >= 0; x -= 20) {
    const y = edgeY + 5 * Math.sin(x / 45) + 3 * Math.sin(x / 17 + 2);
    pts.push(`L${x},${Math.min(118, Math.max(2, y)).toFixed(1)}`);
  }
  $("sand-field").setAttribute("d", `M0,0 L800,0 ${pts.join(" ")} Z`);

  // Shrubs between the sand front and the road.
  const shrubs = env && env.satellite.vegetation_coverage_pct !== null ? Math.min(SHRUB_SLOTS.length,
    Math.round((env.satellite.vegetation_coverage_pct / 25) * SHRUB_SLOTS.length)) : 0;
  $("shrubs").innerHTML = SHRUB_SLOTS.slice(0, shrubs).map(([x, f]) => {
    const y = edgeY + (118 - edgeY) * f;
    return `<circle cx="${x}" cy="${y.toFixed(1)}" r="6" class="shrub"/>`;
  }).join("");

  // Distance marker from the sand front to the road edge.
  const marker = $("distance-marker");
  marker.style.display = dist !== null ? "" : "none";
  if (dist !== null) {
    $("distance-line").setAttribute("y1", edgeY.toFixed(1));
    const label = $("distance-label");
    label.textContent = `${dist} m`;
    label.setAttribute("y", Math.min(112, Math.max(16, (edgeY + 118) / 2 + 5)).toFixed(1));
  }

  // Faster arrows for stronger wind (only animated while running).
  const fieldWind = env ? env.weather.wind_speed_mps : null;
  const wind = fieldWind !== null && fieldWind > 0 ? fieldWind : 5;
  $("wind").style.setProperty("--wind-duration", `${Math.max(0.25, 3 / wind).toFixed(2)}s`);
  $("wind-label").textContent = fieldWind !== null ? `Wind ${fieldWind.toFixed(1)} m/s (sample)` : "Wind";
  $("svg-source-note").textContent = !env ? "Strip above road: no data source"
    : env.data_kind === "satellite-derived" ? "Strip above road: Sentinel-2 analysis (real road, not to scale)"
    : "Strip above road: sample satellite data";
}

function riskMessage(data) {
  const sand = data.sand_depth_cm;
  if (typeof sand !== "number") {
    return data.mode === "live" ? "No live sensor data." : "Waiting for the experiment to start.";
  }
  if (!data.risk_level) return `sand_01 ${sand} cm · not classified (no thresholds agreed yet).`;
  return `Preset label "${data.risk_level.toLowerCase()}" for scenario ${data.scenario_label}: sand_01 ${sand} cm.`;
}

// Eases the drawing from its current depth to the target over ~2.5 s.
// Purely visual: the numbers on screen always show the exact reading.
let roadFraction = 0;
let roadAnimation = null;
function animateRoadTo(target) {
  cancelAnimationFrame(roadAnimation);
  const from = roadFraction;
  if (Math.abs(target - from) < 0.001) return drawSandOnRoad(target);
  const t0 = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - t0) / 2500);
    drawSandOnRoad(from + (target - from) * (1 - Math.pow(1 - t, 3)));
    if (t < 1) roadAnimation = requestAnimationFrame(step);
  };
  roadAnimation = requestAnimationFrame(step);
}

// Draws the sand layer on the road. 0 = no sand, 1 = whole road covered.
// The wavy edge uses fixed sine waves, so the shape does not flicker.
function drawSandOnRoad(fraction) {
  roadFraction = fraction;
  const path = $("sand-on-road");
  if (fraction <= 0) {
    path.setAttribute("d", "");
    return;
  }
  const depth = fraction * ROAD_HEIGHT;
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
    body.innerHTML = '<tr class="empty"><td colspan="8">No readings yet. Press Start to record data.</td></tr>';
    return;
  }
  body.innerHTML = logger.latest(CONFIG.LOG_ROWS_VISIBLE).map((e) => `
    <tr>
      <td>#${e.run_id}</td>
      <td>${formatTime(e.received_at)}</td>
      <td>${e.scenario_id || "live"}</td>
      <td>${e.sensor_id}</td>
      <td>${e.value}</td>
      <td>${e.unit}</td>
      <td>${e.source}</td>
      <td>${e.preset_risk_level ? `<span class="tag" data-level="${displayRisk(e.preset_risk_level)}">${e.preset_risk_level}</span>` : "—"}</td>
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
