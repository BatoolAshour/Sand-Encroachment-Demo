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
 *   "elapsed_s":      12
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
  $("d-json").textContent = JSON.stringify(sensorData, null, 2);
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
