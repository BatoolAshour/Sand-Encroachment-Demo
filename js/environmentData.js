/* =====================================================================
 * environmentData.js — SAMPLE satellite-derived and weather data.
 *
 *   SAMPLE DATA — NOT REAL SENSOR OR SATELLITE MEASUREMENTS.
 *
 * The values below are hand-written, illustrative examples for an arid
 * road corridor in Saudi Arabia. They are fixed (deterministic): the same
 * scenario always shows the same numbers. No satellite imagery has been
 * downloaded or analysed, and no weather service is called.
 *
 * Every record follows ONE schema, so a real provider can replace the
 * sample provider later without changing the dashboard:
 *
 * {
 *   "timestamp":   ISO time the record describes (weather observation time)
 *   "data_source": "sample" | "satellite+weather" | "python-backend"
 *   "scenario":    "low" | "medium" | "high"   (sample data only)
 *   "location":    free-text label of the road segment
 *   "satellite": {
 *     "source":                  sensor name, e.g. "Sentinel-2"
 *     "observation_date":        date of the image (YYYY-MM-DD)
 *     "buffer_m":                width of the analysed strip beside the road (m)
 *     "sand_coverage_pct":       % of the strip classified as loose sand
 *     "vegetation_coverage_pct": % of the strip classified as vegetation
 *     "bare_soil_pct":           % of the strip classified as bare soil/gravel
 *     "distance_to_road_m":      distance from the nearest sand front to the road edge (m)
 *   },
 *   "weather": {
 *     "temperature_c":  air temperature (°C)
 *     "humidity_pct":   relative humidity (%)
 *     "wind_speed_mps": wind speed (m/s)
 *   }
 * }
 * Sand + vegetation + bare soil are shares of the same strip; the rest
 * (up to 100 %) is "other" (asphalt, buildings, shadow…).
 * ===================================================================== */

const SAMPLE_ENVIRONMENT_SCENARIOS = {
  low: {
    timestamp: "2026-10-05T09:00:00Z",
    data_source: "sample",
    scenario: "low",
    location: "Example road segment, Eastern Province (illustrative)",
    satellite: {
      source: "Sentinel-2",
      observation_date: "2026-10-04",
      buffer_m: 200,
      sand_coverage_pct: 18,
      vegetation_coverage_pct: 22,
      bare_soil_pct: 52,
      distance_to_road_m: 120,
    },
    weather: { temperature_c: 31, humidity_pct: 38, wind_speed_mps: 3.2 },
  },

  medium: {
    timestamp: "2026-10-12T09:00:00Z",
    data_source: "sample",
    scenario: "medium",
    location: "Example road segment, Eastern Province (illustrative)",
    satellite: {
      source: "Sentinel-2",
      observation_date: "2026-10-11",
      buffer_m: 200,
      sand_coverage_pct: 42,
      vegetation_coverage_pct: 12,
      bare_soil_pct: 40,
      distance_to_road_m: 45,
    },
    weather: { temperature_c: 36, humidity_pct: 25, wind_speed_mps: 6.8 },
  },

  high: {
    timestamp: "2026-10-20T09:00:00Z",
    data_source: "sample",
    scenario: "high",
    location: "Example road segment, Eastern Province (illustrative)",
    satellite: {
      source: "Sentinel-2",
      observation_date: "2026-10-19",
      buffer_m: 200,
      sand_coverage_pct: 68,
      vegetation_coverage_pct: 4,
      bare_soil_pct: 24,
      distance_to_road_m: 8,
    },
    weather: { temperature_c: 41, humidity_pct: 14, wind_speed_mps: 11.5 },
  },
};


/* ---------------------------------------------------------------------
 * normalizeEnvironmentData — checks one record from ANY provider.
 * Returns a clean copy (numbers clamped to sensible ranges) or null if
 * the record is unusable. Real providers should pass through this too.
 * --------------------------------------------------------------------- */
function normalizeEnvironmentData(raw) {
  if (!raw || !raw.satellite || !raw.weather) return null;
  const num = (v, min, max) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
  };
  const s = raw.satellite;
  const w = raw.weather;
  const clean = {
    timestamp: String(raw.timestamp || ""),
    data_source: String(raw.data_source || "unknown"),
    scenario: raw.scenario || null,
    location: raw.location || "",
    satellite: {
      source: String(s.source || "unknown"),
      observation_date: String(s.observation_date || ""),
      buffer_m: num(s.buffer_m, 0, 10000),
      sand_coverage_pct: num(s.sand_coverage_pct, 0, 100),
      vegetation_coverage_pct: num(s.vegetation_coverage_pct, 0, 100),
      bare_soil_pct: num(s.bare_soil_pct, 0, 100),
      distance_to_road_m: num(s.distance_to_road_m, 0, 100000),
    },
    weather: {
      temperature_c: num(w.temperature_c, -20, 60),
      humidity_pct: num(w.humidity_pct, 0, 100),
      wind_speed_mps: num(w.wind_speed_mps, 0, 60),
    },
  };
  // The four values used by the demo rule must be present.
  const required = [clean.satellite.sand_coverage_pct, clean.satellite.vegetation_coverage_pct,
    clean.satellite.distance_to_road_m, clean.weather.wind_speed_mps];
  return required.some((v) => v === null) ? null : clean;
}


/* ---------------------------------------------------------------------
 * SampleEnvironmentProvider — the ONLY place that knows the data is
 * sample data. load(scenarioKey) returns one record in the schema above.
 *
 * [FUTURE DATA INTEGRATION POINT]
 * To use real data, write another provider with the same load() method
 * (or call applyEnvironmentData(record) in app.js when data arrives), e.g.:
 *   - satellite features computed in Google Earth Engine / Python
 *     (Sentinel-2 land-cover shares + distance from sand front to road)
 *   - weather observations or historical data (e.g. ERA5-Land)
 *   - a JSON message from the Python backend over the existing WebSocket
 * The dashboard only reads the schema, never the provider.
 * --------------------------------------------------------------------- */
const SampleEnvironmentProvider = {
  name: "sample",
  load(scenarioKey) {
    const record = SAMPLE_ENVIRONMENT_SCENARIOS[scenarioKey];
    // Deep copy so the dashboard can never change the stored sample.
    return record ? JSON.parse(JSON.stringify(record)) : null;
  },
};
