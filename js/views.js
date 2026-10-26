/* =====================================================================
 * views.js — sidebar navigation between the five views and the Overview
 * summary cards.
 *
 * Only shows and hides sections: every control keeps its element and its
 * event listeners, so nothing has to be wired again after switching views.
 * The Overview only READS the state of the other parts (app.js state,
 * the experiment log, the satellite cache, the weather panel) and never
 * changes it.
 * ===================================================================== */

const VIEWS = {
  overview:  { title: "Overview",             subtitle: "System status at a glance" },
  road:      { title: "Road Simulation",      subtitle: "Sand-and-road prototype · scenarios or live Arduino readings" },
  satellite: { title: "Satellite Monitoring", subtitle: "Sentinel-2 sand detection on the research routes" },
  weather:   { title: "Weather Monitoring",   subtitle: "Open-Meteo model weather at the research routes" },
  logs:      { title: "Experiment Logs",      subtitle: "Readings recorded by the road simulation" },
};
const DEFAULT_VIEW = "overview";

const Views = {
  current: null,

  init() {
    window.addEventListener("hashchange", () => this.show(this.fromHash()));
    $("btn-menu").addEventListener("click", () => this.menu(!document.body.classList.contains("nav-open")));
    $("sidebar-backdrop").addEventListener("click", () => this.menu(false));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") this.menu(false); });
    // "Show in road field data" (Satellite) opens the Road view first; app.js then scrolls to the panel.
    $("btn-sat-use").addEventListener("click", () => this.go("road", { scroll: false }));
    ["log-filter-run", "log-filter-sensor", "log-filter-source"].forEach((id) =>
      $(id).addEventListener("change", () => renderLog(logger)));
    this.show(this.fromHash(), { scroll: false });
  },

  fromHash() {
    const id = (location.hash || "").replace("#", "");
    return VIEWS[id] ? id : DEFAULT_VIEW;
  },

  // Switches at once (no hashchange round trip), so a caller can scroll right after.
  go(id, opts) {
    if (location.hash !== `#${id}`) history.pushState(null, "", `#${id}`);
    this.show(id, opts);
  },

  show(id, { scroll = true } = {}) {
    if (!VIEWS[id]) id = DEFAULT_VIEW;
    document.querySelectorAll(".view").forEach((v) => { v.hidden = v.dataset.view !== id; });
    document.querySelectorAll(".nav-link").forEach((a) => {
      const on = a.dataset.view === id;
      a.classList.toggle("active", on);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    setText("view-title", VIEWS[id].title);
    setText("view-subtitle", VIEWS[id].subtitle);
    document.title = `${VIEWS[id].title} · Sand Encroachment Monitoring System`;
    this.current = id;
    this.menu(false);
    if (scroll) window.scrollTo({ top: 0 });
    Overview.refresh();
  },

  // Sidebar as a drawer on narrow screens.
  menu(open) {
    document.body.classList.toggle("nav-open", open);
    $("sidebar-backdrop").hidden = !open;
    $("btn-menu").setAttribute("aria-expanded", String(open));
  },
};

/* ---------------------------------------------------------------------
 * Overview: summary cards, refreshed every second and on view changes.
 * Every lookup is guarded, so a part that failed to start shows "—".
 * --------------------------------------------------------------------- */
const Overview = {
  init() {
    setText("ov-bridge-url", CONFIG.LIVE_BACKEND_URL || "switched off in config.js");
    window.addEventListener("online", () => this.refresh());
    window.addEventListener("offline", () => this.refresh());
    setInterval(() => this.refresh(), 1000);
    this.refresh();
  },

  refresh() {
    try { this.simulation(); } catch (e) { /* app.js not started */ }
    try { this.satellite(); } catch (e) { /* satellite part missing */ }
    try { this.weather(); } catch (e) { /* weather part missing */ }
    try { this.log(); } catch (e) { /* logger missing */ }
    this.checks();
  },

  simulation() {
    const live = state.mode === "live";
    const sand = state.readings.sand_01;
    const wind = state.readings.wind_01;
    setText("ov-sand", sand ? Number(sand.value).toFixed(1) : "--");
    setText("ov-wind", wind ? Number(wind.value).toFixed(1) : "--");
    const status = $("ov-status");
    status.dataset.status = state.status;
    status.textContent = STATUS_LABELS[state.status] || state.status;
    $("nav-run-state").dataset.status = state.status;
    setText("ov-mode", MODE_LABELS[state.mode]);
    setText("ov-scenario", live ? "— (live readings)" : (state.scenarioMeta ? state.scenarioMeta.label : displayRisk(state.scenario)));
    setText("ov-risk", state.status === "reset" ? "—" : ($("risk-message").dataset.level || "Not classified"));
    const origin = $("ov-sim-origin");
    origin.dataset.origin = live ? "live" : "simulated";
    origin.textContent = live ? "Live sensor" : "Simulated";

    // Bridge card mirrors the connection indicator in Live mode only.
    const dot = $("ov-bridge-dot");
    if (!live) {
      dot.dataset.state = "idle";
      setText("ov-bridge-text", "Not in use: Scenario / Demo mode");
    } else {
      dot.dataset.state = $("connection").dataset.state;
      setText("ov-bridge-text", $("connection-text").textContent);
    }
    setText("ov-bridge-last", live && state.receivedAt ? formatTime(state.receivedAt) : "—");
  },

  satellite() {
    const analyses = (typeof SATELLITE_CACHE !== "undefined" && SATELLITE_CACHE.analyses) || [];
    const routes = SatelliteCache.routes();
    setText("ov-sat-count", String(analyses.length));
    const segs = new Set(analyses.map((a) => a.segment && a.segment.id).filter(Boolean));
    setText("ov-sat-count-label", `cached analyses · ${segs.size} segments`);
    setText("ov-sat-routes", routes.length ? `${routes.length} research routes, ${routes.reduce((n, r) => n + r.segments.length, 0)} segments` : "—");
    const r = SatelliteMonitor.result;
    setText("ov-sat-shown", r && r.segment
      ? `${r.route.name.replace(/^Route \d+: /, "")} · seg ${r.segment.index} · ${r.scene.date} · ${r.measurements.area_sand_coverage_pct}% sand`
      : "nothing selected");
  },

  weather() {
    setText("ov-wx-count", String(Object.keys(WeatherCache.bundled.entries || {}).length));
    const rec = WeatherPanel.record;
    if (rec) {
      const v = weatherView(rec, Number($("wx-hour").value));
      setText("ov-wx-loaded", `${rec.date} · ${v.at.wind_speed_mps ?? "—"} m/s from ${compassName(v.at.wind_direction_deg)}`);
    } else {
      setText("ov-wx-loaded", "nothing loaded yet");
    }
    setText("ov-wx-net", navigator.onLine ? "online · Open-Meteo can be asked" : "offline · cached weather only");
  },

  log() {
    const entries = logger.entries;
    const runs = new Set(entries.map((e) => e.run_id));
    setText("ov-log-count", String(entries.length));
    setText("ov-log-runs", String(runs.size));
    setText("ov-log-last", entries.length ? formatTime(entries[entries.length - 1].received_at) : "—");
  },

  checks() {
    const items = [
      ["Shared scenario data", typeof state !== "undefined" && state.dataReady, "loaded and valid", "not loaded"],
      ["Satellite cache", typeof SATELLITE_CACHE !== "undefined", "available offline", "missing"],
      ["Weather cache", typeof WEATHER_CACHE !== "undefined", "available offline", "not shipped"],
      ["Internet", navigator.onLine, "online", "offline: cached data only"],
    ];
    const html = items.map(([name, ok, yes, no]) =>
      `<li data-ok="${ok ? "yes" : "no"}"><span class="state-dot" data-state="${ok ? "connected" : "disconnected"}"></span>${name}<span>${ok ? yes : no}</span></li>`).join("");
    const box = $("ov-checks");
    if (box && box.innerHTML !== html) box.innerHTML = html;
  },
};

document.addEventListener("DOMContentLoaded", () => {
  try { Views.init(); } catch (err) { console.error("Navigation could not start", err); }
  // After app.js has started (its DOMContentLoaded handler awaits the data file).
  window.addEventListener("load", () => {
    try { Overview.init(); } catch (err) { console.error("Overview could not start", err); }
  });
});
