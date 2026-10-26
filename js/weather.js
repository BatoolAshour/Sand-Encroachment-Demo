/* =====================================================================
 * weather.js — REAL weather for the research routes (Open-Meteo).
 *
 * Where the numbers come from (no API key, called from the browser):
 *   Historical  archive-api.open-meteo.com  ERA5 / ERA5-Land reanalysis,
 *               about 5 days behind real time
 *   Recent      api.open-meteo.com with a past date: the weather models'
 *               own analysis, for days the archive does not cover yet
 *   Current     api.open-meteo.com "current" block (model, every 15 min)
 * Future dates are refused: forecasts / predictions are out of scope.
 *
 * Point: the centre of the chosen route segment (routes.json, from the
 * KMZ files). Values are modelled for the grid cell around it, not a
 * weather-station measurement.
 *
 * Cache (offline demos), checked in this order for historical data:
 *   1. this browser (localStorage, every successful fetch)
 *   2. data/weather/weather_cache.js (python/weather_cache.py, shipped)
 * Current conditions always try the network first and fall back to a
 * cached copy, labelled with its fetch time.
 *
 * This is real-world weather at a road. It is NEVER turned into wind_01
 * readings, never drives the Arduino fan or the road animation, never
 * enters the experiment log and is not used for any risk level.
 * ===================================================================== */

const WX_HOURLY = ["temperature_2m", "relative_humidity_2m", "precipitation",
  "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m"];
const WX_DAILY = ["temperature_2m_max", "temperature_2m_min", "precipitation_sum",
  "wind_speed_10m_max", "wind_gusts_10m_max", "wind_direction_10m_dominant"];
const WX_LOCAL_STORE = "pro01.weather.";

// ---------- Dates in the routes' time zone (Asia/Riyadh, UTC+3, no DST) ----------
const WxTime = {
  offsetH: 3,
  today() { return new Date(Date.now() + this.offsetH * 3600e3).toISOString().slice(0, 10); },
  daysAgo(date) { return Math.round((Date.parse(this.today()) - Date.parse(date)) / 86400e3); },
  localHourOf(isoUtc) {             // satellite scene time (UTC) -> local hour
    const t = Date.parse(isoUtc);
    return Number.isFinite(t) ? new Date(t + this.offsetH * 3600e3).getUTCHours() : null;
  },
};

// ---------- Requests ----------
function weatherRequest(point, date) {
  const age = WxTime.daysAgo(date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) throw new Error("Choose an observation date.");
  if (age < 0) throw new Error("Future dates would be forecasts. Predictions are not part of this dashboard.");
  if (age > 0 && date < "1940-01-01") throw new Error("Open-Meteo history starts in 1940.");
  const kind = age === 0 ? "current" : "historical";
  const api = age >= CONFIG.WEATHER_ARCHIVE_MIN_AGE_DAYS ? "archive" : "forecast";
  const q = new URLSearchParams({
    latitude: point.lat.toFixed(5), longitude: point.lon.toFixed(5),
    start_date: date, end_date: date,
    hourly: WX_HOURLY.join(","), daily: WX_DAILY.join(","),
    timezone: CONFIG.WEATHER_TIMEZONE, wind_speed_unit: "ms",
  });
  if (kind === "current") q.set("current", WX_HOURLY.join(","));
  const base = api === "archive" ? CONFIG.OPEN_METEO_ARCHIVE_URL : CONFIG.OPEN_METEO_FORECAST_URL;
  return { kind, api, url: `${base}?${q}` };
}

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONFIG.WEATHER_REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { signal: ctrl.signal });
  } catch (err) {
    throw new Error(err.name === "AbortError"
      ? "Open-Meteo did not answer in time."
      : "Open-Meteo is not reachable (offline, or blocked by the network).");
  } finally {
    clearTimeout(timer);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.error) {
    throw new Error(`Open-Meteo error${res.ok ? "" : ` ${res.status}`}: ${(body && body.reason) || "unexpected answer"}.`);
  }
  return body;
}

// ---------- One record = one Open-Meteo answer + where/when it was asked ----------
// Shared with python/weather_cache.py (same fields, raw API response kept).
const WeatherCache = {
  bundled: typeof WEATHER_CACHE !== "undefined" ? WEATHER_CACHE : { entries: {} },
  memory: {},
  key(segmentId, date) { return `${segmentId}|${date}`; },
  get(key) {
    if (this.memory[key]) return { record: this.memory[key], where: "memory" };
    try {
      const raw = localStorage.getItem(WX_LOCAL_STORE + key);
      if (raw) return { record: JSON.parse(raw), where: "browser" };
    } catch (e) { /* storage blocked: fine */ }
    const b = (this.bundled.entries || {})[key];
    return b ? { record: b, where: "bundled" } : null;
  },
  put(record) {
    this.memory[record.key] = record;
    try { localStorage.setItem(WX_LOCAL_STORE + record.key, JSON.stringify(record)); } catch (e) { /* full or blocked */ }
  },
  has(segmentId, date) { return !!this.get(this.key(segmentId, date)); },
};

const WeatherService = {
  /** -> { record, from: "network" | "memory" | "browser" | "bundled", warning? } */
  async get(point, date, { force = false } = {}) {
    const req = weatherRequest(point, date);          // throws for bad / future dates
    const key = WeatherCache.key(point.segment_id, date);
    const cached = WeatherCache.get(key);
    if (!force && cached && req.kind === "historical" && cached.record.kind === "historical") {
      return { record: cached.record, from: cached.where };
    }
    try {
      let api = req.api;
      let response = await fetchJson(req.url);
      let url = req.url;
      // The archive lags a few days; for a recent date fall back to the models' analysis.
      if (api === "archive" && !hasValues(response) && WxTime.daysAgo(date) <= 92) {
        url = req.url.replace(CONFIG.OPEN_METEO_ARCHIVE_URL, CONFIG.OPEN_METEO_FORECAST_URL);
        response = await fetchJson(url);
        api = "forecast";
      }
      checkResponse(response, point);
      const record = {
        v: 1, key, kind: req.kind, api, url,
        route_id: point.route_id, segment_id: point.segment_id, lat: point.lat, lon: point.lon, date,
        fetched_at: new Date().toISOString().slice(0, 19) + "Z",
        response,
      };
      WeatherCache.put(record);
      return { record, from: "network" };
    } catch (err) {
      // A copy from this session is in local storage too: label it as cached.
      if (cached) return { record: cached.record, from: cached.where === "memory" ? "browser" : cached.where, warning: err.message };
      throw err;
    }
  },
};

function hasValues(r) {
  return !!(r && r.hourly && (r.hourly.wind_speed_10m || []).some((v) => v !== null));
}

function checkResponse(r, point) {
  if (!r.hourly || !Array.isArray(r.hourly.time) || r.hourly.time.length === 0) {
    throw new Error("Open-Meteo returned no hourly data for this date.");
  }
  if (r.hourly_units && r.hourly_units.wind_speed_10m && r.hourly_units.wind_speed_10m !== "m/s") {
    throw new Error(`Unexpected wind unit ${r.hourly_units.wind_speed_10m}.`);
  }
  // The grid cell must be near the requested point (catches swapped coordinates).
  if (Math.abs(r.latitude - point.lat) > 0.5 || Math.abs(r.longitude - point.lon) > 0.5) {
    throw new Error("Open-Meteo answered for a different place.");
  }
  if (!hasValues(r)) throw new Error("No weather data for this date at this point yet.");
}

/* ---------------------------------------------------------------------
 * Record -> values shown for one local hour (current: the "current" block).
 * Missing values stay null ("—"); nothing is filled in.
 * --------------------------------------------------------------------- */
function weatherView(record, hour) {
  const r = record.response;
  const h = r.hourly;
  const pick = (block, i) => ({
    wind_speed_mps: block.wind_speed_10m[i], wind_direction_deg: block.wind_direction_10m[i],
    wind_gust_mps: block.wind_gusts_10m[i], temperature_c: block.temperature_2m[i],
    humidity_pct: block.relative_humidity_2m[i], precipitation_mm: block.precipitation[i],
  });
  let at;
  let time;
  if (record.kind === "current" && r.current) {
    const c = r.current;
    at = {
      wind_speed_mps: c.wind_speed_10m, wind_direction_deg: c.wind_direction_10m, wind_gust_mps: c.wind_gusts_10m,
      temperature_c: c.temperature_2m, humidity_pct: c.relative_humidity_2m, precipitation_mm: c.precipitation,
    };
    time = c.time;
  } else {
    const want = `${record.date}T${String(hour).padStart(2, "0")}:00`;
    const i = h.time.indexOf(want);
    if (i < 0) throw new Error(`No hourly value for ${want}.`);
    at = pick(h, i);
    time = want;
  }
  const d = r.daily || {};
  const d0 = (k) => (d[k] ? d[k][0] : null);
  const daily = record.kind === "current" && r.current
    ? dailySoFar(h, r.current.time)
    : {
      wind_speed_max_mps: d0("wind_speed_10m_max"), wind_gust_max_mps: d0("wind_gusts_10m_max"),
      wind_direction_dominant_deg: d0("wind_direction_10m_dominant"),
      temperature_max_c: d0("temperature_2m_max"), temperature_min_c: d0("temperature_2m_min"),
      precipitation_sum_mm: d0("precipitation_sum"),
    };
  return {
    time, at, daily,
    so_far: record.kind === "current" && !!r.current,
    interval_min: r.current && r.current.interval ? r.current.interval / 60 : 60,
    grid: { lat: r.latitude, lon: r.longitude, elevation_m: r.elevation },
  };
}

// Today: summarise only the hours up to now, so no forecast hours are shown.
function dailySoFar(h, now) {
  const idx = h.time.map((t, i) => (t <= now ? i : -1)).filter((i) => i >= 0);
  const vals = (k) => idx.map((i) => h[k][i]).filter((v) => v !== null && v !== undefined);
  const max = (k) => (vals(k).length ? Math.max(...vals(k)) : null);
  const min = (k) => (vals(k).length ? Math.min(...vals(k)) : null);
  const rain = vals("precipitation");
  // Dominant direction: mean of the wind vectors (speed-weighted).
  let u = 0, v = 0;
  idx.forEach((i) => {
    const s = h.wind_speed_10m[i], dir = h.wind_direction_10m[i];
    if (s === null || dir === null) return;
    u += s * Math.sin(dir * Math.PI / 180);
    v += s * Math.cos(dir * Math.PI / 180);
  });
  const dom = u === 0 && v === 0 ? null : (Math.atan2(u, v) * 180 / Math.PI + 360) % 360;
  return {
    wind_speed_max_mps: max("wind_speed_10m"), wind_gust_max_mps: max("wind_gusts_10m"),
    wind_direction_dominant_deg: dom,
    temperature_max_c: max("temperature_2m"), temperature_min_c: min("temperature_2m"),
    precipitation_sum_mm: rain.length ? Math.round(rain.reduce((a, b) => a + b, 0) * 10) / 10 : null,
  };
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const compassName = (deg) => (deg === null || deg === undefined ? "—" : COMPASS[Math.round(deg / 22.5) % 16]);

function weatherLabel(record, from) {
  const label = record.kind === "current"
    ? { kind: "current", text: "Current · Open-Meteo weather models (updated every 15 min)" }
    : record.api === "archive"
      ? { kind: "historical", text: "Historical · ERA5 / ERA5-Land reanalysis via Open-Meteo" }
      : { kind: "historical", text: "Historical (recent) · weather-model analysis via Open-Meteo; archive not out yet" };
  if (from !== "network" && from !== "memory") {
    label.text += ` · offline cache (${from === "bundled" ? "shipped with the dashboard" : "this browser"}, fetched ${record.fetched_at.replace("T", " ").replace("Z", " UTC")})`;
    label.cached = true;
  }
  return label;
}


// ---------- Hourly wind chart (Weather view) ----------
// Bars = gusts, line = 10 m wind speed, arrows = direction the wind blows TO.
// Today: only the hours up to now (no forecast hours are drawn).
function weatherChartSvg(record, hour) {
  const h = record.response.hourly;
  const now = record.kind === "current" && record.response.current ? record.response.current.time : null;
  const W = 960, H = 250, x0 = 44, x1 = W - 12, y0 = 40, y1 = H - 28;
  const bw = (x1 - x0) / 24;
  const pts = h.time.map((t, i) => ({
    i, hr: Number(t.slice(11, 13)),
    speed: now && t > now ? null : h.wind_speed_10m[i],
    gust: now && t > now ? null : h.wind_gusts_10m[i],
    dir: now && t > now ? null : h.wind_direction_10m[i],
  }));
  const top = Math.max(5, ...pts.map((p) => Math.max(p.speed || 0, p.gust || 0)));
  const step = top > 20 ? 10 : 5;
  const ymax = Math.ceil(top / step) * step;
  const Y = (v) => y1 - (v / ymax) * (y1 - y0);
  const X = (hr) => x0 + bw * hr + bw / 2;
  const out = [];
  for (let v = 0; v <= ymax; v += step) {
    out.push(`<line class="ch-grid" x1="${x0}" x2="${x1}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ch-tick" x="${x0 - 8}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`);
  }
  out.push(`<text class="ch-tick" x="${x0 - 8}" y="${y0 - 14}" text-anchor="end">m/s</text>`);
  const sel = pts.find((p) => p.hr === hour);
  if (sel && !now) out.push(`<rect class="ch-sel" x="${x0 + bw * sel.hr}" y="${y0 - 30}" width="${bw}" height="${y1 - y0 + 30}" rx="4"/>`);
  pts.forEach((p) => {
    if (p.gust !== null && p.gust !== undefined) {
      out.push(`<rect class="ch-gust" x="${X(p.hr) - bw * 0.32}" y="${Y(p.gust)}" width="${bw * 0.64}" height="${y1 - Y(p.gust)}" rx="2"/>`);
    }
    if (p.hr % 3 === 0) {
      out.push(`<text class="ch-tick" x="${X(p.hr)}" y="${H - 8}" text-anchor="middle">${String(p.hr).padStart(2, "0")}</text>`);
      if (p.dir !== null && p.dir !== undefined) {
        out.push(`<g transform="rotate(${(p.dir + 180) % 360} ${X(p.hr)} ${y0 - 18})"><path class="ch-arrow" d="M${X(p.hr)} ${y0 - 27} l5 9 h-3.5 v8 h-3 v-8 h-3.5z"/></g>`);
      }
    }
  });
  const line = pts.filter((p) => p.speed !== null && p.speed !== undefined).map((p) => `${X(p.hr)},${Y(p.speed)}`);
  if (line.length) out.push(`<polyline class="ch-speed" points="${line.join(" ")}"/>`);
  pts.forEach((p) => { if (p.speed !== null && p.speed !== undefined) out.push(`<circle class="ch-dot${p.hr === hour && !now ? " on" : ""}" cx="${X(p.hr)}" cy="${Y(p.speed)}" r="${p.hr === hour && !now ? 4.5 : 2.5}"/>`); });
  if (!now) pts.forEach((p) => out.push(`<rect class="ch-hit" data-hour="${p.hr}" x="${x0 + bw * p.hr}" y="${y0 - 30}" width="${bw}" height="${y1 - y0 + 30}"><title>${String(p.hr).padStart(2, "0")}:00 · ${p.speed ?? "—"} m/s, gusts ${p.gust ?? "—"} m/s</title></rect>`));
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Hourly wind speed and gusts on ${record.date}">${out.join("")}</svg>`;
}

// ---------- The weather block (Weather Monitoring view) ----------
const WeatherPanel = {
  ready: false,
  busy: false,
  userPicked: false,
  record: null,
  from: null,

  init() {
    const missing = ["wx-route", "wx-segment", "wx-date", "wx-hour", "btn-wx-get", "btn-wx-refresh", "btn-wx-sat",
      "wx-status", "wx-badge", "wx-arrow"].filter((id) => !$(id));
    if (missing.length) throw new Error(`weather block is missing #${missing.join(", #")}`);
    const routes = (typeof SatelliteCache !== "undefined" ? SatelliteCache.routes() : []);
    const sel = $("wx-route");
    routes.forEach((r) => sel.add(new Option(r.name, r.id)));
    for (let h = 0; h < 24; h++) $("wx-hour").add(new Option(`${String(h).padStart(2, "0")}:00`, String(h)));
    $("wx-hour").value = String(CONFIG.WEATHER_DEFAULT_HOUR);
    $("wx-date").max = WxTime.today();
    $("wx-date").value = routes[0] ? routes[0].default_date : WxTime.today();

    const picked = () => { this.userPicked = true; };
    ["wx-route", "wx-segment", "wx-date"].forEach((id) => $(id).addEventListener("change", picked));
    sel.addEventListener("change", () => this.fillSegments());
    $("wx-segment").addEventListener("change", () => this.clear());
    $("wx-date").addEventListener("change", () => this.dateChanged());
    $("wx-hour").addEventListener("change", () => this.render());
    if ($("wx-chart")) {
      $("wx-chart").addEventListener("click", (e) => {
        const hit = e.target.closest("[data-hour]");
        if (!hit || $("wx-hour").disabled) return;
        $("wx-hour").value = hit.dataset.hour;
        this.render();
      });
    }
    $("btn-wx-get").addEventListener("click", () => this.load(false));
    $("btn-wx-refresh").addEventListener("click", () => this.load(true));
    $("btn-wx-sat").addEventListener("click", () => { this.userPicked = true; this.matchSatellite(true); });
    this.fillSegments();
    this.dateChanged();
    // Start with the shown satellite image when its weather is cached (no network at start-up).
    this.ready = true;
    this.satelliteChanged();
  },

  route() { return SatelliteCache.route($("wx-route").value); },
  point() {
    const r = this.route();
    const seg = r && r.segments.find((s) => s.id === $("wx-segment").value);
    return seg ? { route_id: r.id, segment_id: seg.id, lat: seg.center[1], lon: seg.center[0], seg, route: r } : null;
  },

  fillSegments(selectId) {
    const r = this.route();
    const segSel = $("wx-segment");
    segSel.innerHTML = "";
    if (r) {
      r.segments.forEach((s) => {
        const tag = WeatherCache.has(s.id, $("wx-date").value) ? " · cached" : "";
        segSel.add(new Option(`${s.index} · km ${(s.start_m / 1000).toFixed(1)}–${(s.end_m / 1000).toFixed(1)}${tag}`, s.id));
      });
      if (selectId) segSel.value = selectId;
    }
    this.clear();
  },

  dateChanged() {
    const isToday = $("wx-date").value === WxTime.today();
    $("wx-hour").disabled = isToday;
    this.fillSegments($("wx-segment").value);
  },

  // Enabled while the Satellite Monitoring section shows a route segment.
  // Until the user picks something, follow the shown image (cached weather only).
  satelliteChanged() {
    if (!this.ready) return;
    const r = typeof SatelliteMonitor !== "undefined" ? SatelliteMonitor.result : null;
    $("btn-wx-sat").disabled = !(r && r.segment);
    if (r && r.segment && !this.userPicked && !this.busy) this.matchSatellite(false);
  },

  matchSatellite(fetchIfMissing) {
    const r = typeof SatelliteMonitor !== "undefined" ? SatelliteMonitor.result : null;
    if (!r || !r.segment) return;
    $("wx-route").value = r.route.id;
    $("wx-date").value = r.scene.date;
    const hour = WxTime.localHourOf(r.scene.datetime);
    $("wx-hour").value = String(hour === null ? CONFIG.WEATHER_DEFAULT_HOUR : hour);
    $("wx-hour").disabled = r.scene.date === WxTime.today();
    this.fillSegments(r.segment.id);
    if (fetchIfMissing || WeatherCache.has(r.segment.id, r.scene.date)) this.load(false);
  },

  async load(force) {
    if (this.busy) return;
    const p = this.point();
    if (!p) return this.status("error", "Choose a route segment.");
    this.setBusy(true);
    this.status("loading", force ? "Loading from Open-Meteo…" : "Loading weather…");
    try {
      const { record, from, warning } = await WeatherService.get(p, $("wx-date").value, { force });
      this.record = record;
      this.from = from;
      this.fillSegmentsKeep();      // updates the "· cached" marks, keeps the record
      const where = from === "network" ? "Loaded from Open-Meteo." : "Shown from the offline cache.";
      this.status(warning ? "warn" : "ok", warning ? `${warning} Showing the cached copy instead.` : where);
    } catch (err) {
      this.clear();
      this.status("error", err.message);
    } finally {
      this.setBusy(false);
    }
  },

  fillSegmentsKeep() {
    const id = $("wx-segment").value;
    const keep = this.record;
    const from = this.from;
    this.fillSegments(id);
    this.record = keep;
    this.from = from;
    this.render();
  },

  setBusy(busy) {
    this.busy = busy;
    ["btn-wx-get", "btn-wx-refresh"].forEach((id) => { $(id).disabled = busy; });
    $("btn-wx-get").textContent = busy ? "Loading…" : "Get weather";
  },

  status(state, text) {
    $("wx-status").dataset.state = state;
    $("wx-status").textContent = text;
  },

  clear() {
    this.record = null;
    this.from = null;
    this.status("idle", "Pick a route, segment and date, then press Get weather.");
    this.render();
  },

  render() {
    const set = setText;
    const show = (v, digits = 1) => (v === null || v === undefined ? "—" : Number(v).toFixed(digits));
    const ids = ["wx-wind", "wx-gust", "wx-dir", "wx-temp", "wx-hum", "wx-precip"];
    const p = this.point();
    if (!this.record) {
      ids.forEach((id) => set(id, "—"));
      set("wx-dir-text", "—");
      set("wx-daily", "—");
      set("wx-meta", p ? `Point: centre of segment ${p.seg.index}, ${p.lat.toFixed(4)}°N, ${p.lon.toFixed(4)}°E (from the route KMZ).` : "—");
      $("wx-arrow").setAttribute("visibility", "hidden");
      $("wx-badge").dataset.kind = "none";
      set("wx-badge", "No real weather loaded");
      set("wx-time", "—");
      if ($("wx-chart")) $("wx-chart").innerHTML = '<p class="empty-state">Load weather to see the hourly wind.</p>';
      return;
    }
    let v;
    try {
      v = weatherView(this.record, Number($("wx-hour").value));
    } catch (err) {
      this.record = null;
      this.render();
      this.status("error", err.message);
      return;
    }
    const a = v.at;
    set("wx-wind", show(a.wind_speed_mps));
    set("wx-gust", show(a.wind_gust_mps));
    set("wx-dir", show(a.wind_direction_deg, 0));
    set("wx-temp", show(a.temperature_c));
    set("wx-hum", show(a.humidity_pct, 0));
    set("wx-precip", show(a.precipitation_mm));
    if (a.wind_direction_deg === null || a.wind_direction_deg === undefined) {
      $("wx-arrow").setAttribute("visibility", "hidden");
      set("wx-dir-text", "Direction not available");
    } else {
      // Meteorological direction = where the wind comes FROM; the arrow shows where it blows TO.
      $("wx-arrow").setAttribute("visibility", "visible");
      $("wx-arrow").setAttribute("transform", `rotate(${(a.wind_direction_deg + 180) % 360} 60 60)`);
      set("wx-dir-text", `From ${compassName(a.wind_direction_deg)} (${Math.round(a.wind_direction_deg)}°), ` +
        `blowing toward ${compassName((a.wind_direction_deg + 180) % 360)}`);
    }
    const d = v.daily;
    set("wx-daily", `${v.so_far ? "Today so far" : "Whole day"} (${this.record.date}, local): wind max ${show(d.wind_speed_max_mps)} m/s · ` +
      `gusts max ${show(d.wind_gust_max_mps)} m/s · mostly from ${compassName(d.wind_direction_dominant_deg)} · ` +
      `${show(d.temperature_min_c)}–${show(d.temperature_max_c)} °C · rain ${show(d.precipitation_sum_mm)} mm`);
    set("wx-time", this.record.kind === "current"
      ? `Now: ${v.time.replace("T", " ")} local (Asia/Riyadh) · precipitation over the preceding ${v.interval_min} min`
      : `${v.time.replace("T", " ")} local (Asia/Riyadh) · hourly value, precipitation over the preceding hour`);
    const label = weatherLabel(this.record, this.from);
    $("wx-badge").dataset.kind = label.cached ? `${label.kind}-cached` : label.kind;
    set("wx-badge", label.text);
    const r = SatelliteCache.route(this.record.route_id);
    const seg = r && r.segments.find((s) => s.id === this.record.segment_id);
    set("wx-meta", `${r ? r.name : this.record.route_id} · segment ${seg ? seg.index : "?"} centre ` +
      `${this.record.lat.toFixed(4)}°N, ${this.record.lon.toFixed(4)}°E → model grid ${v.grid.lat.toFixed(2)}°N, ` +
      `${v.grid.lon.toFixed(2)}°E, ${v.grid.elevation_m ?? "—"} m. Modelled for the grid cell, not a weather-station reading.`);
    if ($("wx-chart")) $("wx-chart").innerHTML = weatherChartSvg(this.record, Number($("wx-hour").value));
  },
};
