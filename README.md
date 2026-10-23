# Sand Encroachment Monitoring System — PRO-01 Digital Demo & Dashboard

A browser dashboard for the physical prototype (a road inside a box with sand, a wind fan
and sensors). It plays fixed demo scenarios from the team's **shared mock data** file and is
ready to show real sensor readings later.

> **Scenario / Demo only.** All values are fixed and illustrative, not real sensor readings.
> Risk levels are preset display labels, not outputs of a trained model or validated thresholds.

---

## 1. How to run it

**Recommended (reads `data/shared_mock_data.json` directly):**
```bash
cd Sand-Encroachment-Demo        # the project folder
python3 -m http.server 8000
```
Then open <http://localhost:8000>.

**Quick (no terminal):** double-click `index.html`. Browsers block reading JSON files this way,
so the page uses `js/sharedMockData.js`, an exact generated copy of the same file. The banner
under the title always says which one was loaded.

No internet or backend is needed either way.

---

## 2. Folder structure

```
├── index.html                 Page layout
├── css/styles.css             Colours, layout, responsive rules
├── js/
│   ├── config.js              Settings: data file path, API/WebSocket URLs, display scale
│   ├── sharedMockData.js      GENERATED copy of shared_mock_data.json (do not edit)
│   ├── scenarioData.js        Loads + validates the shared file; future PRO-06 API provider
│   ├── dataSources.js         ScenarioSource (Scenario / Demo) and LiveSensorSource
│   ├── risk.js                Risk label helpers, road condition, live thresholds
│   ├── environmentData.js     Field data SAMPLE (satellite + weather)
│   ├── environmentRule.js     Demo multi-variable indicator + explanation
│   ├── logger.js              Experiment log + CSV export
│   ├── dashboard.js           Drawing: updateDashboard(sensorData) and helpers
│   └── app.js                 State + button logic; connects everything
├── python/
│   ├── sync_shared_data.py    Regenerates / checks js/sharedMockData.js
│   ├── bridge.py              Reference Arduino → WebSocket template (PRO-06 owns the backend)
│   └── requirements.txt
└── data/
    ├── shared_mock_data.json          CANONICAL shared mock data v1.0 (unchanged)
    ├── SHARED_MOCK_DATA_README.txt    Rules that came with it
    ├── sample_reading.json            Example of the dashboard's data object
    ├── sample_environment_scenarios.json  Field data sample (copy of the JS)
    └── sample_backend_message.json    Example live message (contract format)
```

### How the files work together

```
 shared_mock_data.json ─► scenarioData.js (load + validate)
                                  │
 [Start/Stop/Reset, scenario] ─► app.js ◄── dataSources.js (Scenario or Live readings)
                                  │
                                  ├─► logger.js     one CSV row per reading
                                  └─► dashboard.js  updateDashboard(sensorData)
```

---

## 3. Shared mock data v1.0 (PRO-01 + PRO-06)

`data/shared_mock_data.json` is used **unchanged** (checked byte-for-byte against the file
the team shared). Scenario IDs: `low`, `medium`, `high`.

| Scenario | wind_01 | sand_01 | Preset risk_level |
|---|---|---|---|
| Low | 2.0 m/s | 0.5 cm | low |
| Medium | 6.0 m/s | 2.5 cm | medium |
| High | 11.0 m/s | 5.0 cm | high |

Every reading has exactly six contract fields:

| Field | Meaning |
|---|---|
| `timestamp` | ISO 8601 UTC time of the reading |
| `sensor_id` | `wind_01` or `sand_01` (provisional IDs) |
| `value` | number |
| `unit` | `m/s` for wind_01, `cm` for sand_01 |
| `source` | `scenario` (not live) |
| `status` | `ok` |

**Validation:** on load the dashboard checks the schema version, the three scenario IDs, the six
fields, the units per sensor, `source` and `status`. If anything is wrong it shows the list of
problems and plays nothing. It never fixes, converts or guesses values.

**Keeping the embedded copy identical:** after the team agrees a new file version, replace
`data/shared_mock_data.json` and run:
```bash
python3 python/sync_shared_data.py          # regenerate js/sharedMockData.js
python3 python/sync_shared_data.py --check  # confirm they match
```
Also update `CONFIG.SHARED_DATA.schemaVersion` in `js/config.js`.

---

## 4. How Scenario / Demo works

| Control | What it does |
|---|---|
| **Scenario** | Low / Medium / High (labels come from the file). Shows the scenario's values in the hint line and updates the field data sample. |
| **Start** | Starts a run (new run number after Reset). The selected scenario's readings are delivered now and again every 2 s (`TICK_INTERVAL_MS`), the same way the dashboard will later poll the PRO-06 API. After Stop it shows **Resume**. |
| **Stop** | Pauses delivery. Values stay on screen. |
| **Reset** | Clears readings, risk and timer; status = Reset. The log is kept (use **Clear log**). |
| **Changing scenario while running** | The new scenario's readings appear immediately. |
| **Sensor mode** | Scenario / Demo ↔ Live Sensor. Switching resets the run so demo and real values never mix. |

What is shown for a scenario:
- **Sand depth (sand_01)** and **Wind speed (wind_01)**: the exact file values.
- **Risk level**: the preset `risk_level` from the file (Low / Medium / High pills).
- **Road condition**: text linked to that label (`ROAD_CONDITION_BY_RISK` in config.js).
- **Road picture**: sand layer drawn to `depth ÷ SAND_DEPTH_DISPLAY_MAX_CM` (6 cm) of the road. It
  eases to the new depth over about 2.5 s. This is only animation: the numbers always show the
  exact reading, and no in-between values are logged.
- **Live data panel**: the readings table shows the six contract fields exactly as received.

Nothing in Scenario / Demo is random or generated in the browser.

### Risk in Live Sensor Mode

Real readings have no preset label. `CONFIG.SAND_DEPTH_THRESHOLDS_CM` is `null` because no cm
thresholds have been agreed, so live risk shows **Not classified**. When the team agrees values,
set e.g. `{ lowMax: 1.0, mediumMax: 3.0 }` (example numbers only).

---

## 5. Field data sample (satellite + weather)

> **SAMPLE DATA — NOT REAL SENSOR OR SATELLITE MEASUREMENTS.**
> The values are hand-written examples for an arid road corridor in Saudi Arabia.
> No Sentinel-2 imagery has been downloaded or analysed and no weather service is called.
> The values are fixed, so each scenario shows the same numbers every time.

Each scenario loads one record from `js/environmentData.js`:

```json
{
  "timestamp": "2026-10-12T09:00:00Z",
  "data_source": "sample",
  "scenario": "medium",
  "location": "Example road segment, Eastern Province (illustrative)",
  "satellite": {
    "source": "Sentinel-2",
    "observation_date": "2026-10-11",
    "buffer_m": 200,
    "sand_coverage_pct": 42,
    "vegetation_coverage_pct": 12,
    "bare_soil_pct": 40,
    "distance_to_road_m": 45
  },
  "weather": { "temperature_c": 36, "humidity_pct": 25, "wind_speed_mps": 6.8 }
}
```

| Field | Unit | Meaning / why it matters |
|---|---|---|
| `timestamp` | ISO 8601 | Time the record describes (weather observation time) |
| `data_source` | text | `sample` now; later e.g. `satellite+weather` or `python-backend` |
| `satellite.source` | text | Sensor the features would come from (Sentinel-2) |
| `satellite.observation_date` | YYYY-MM-DD | Date of the satellite image |
| `satellite.buffer_m` | m | Width of the strip beside the road that the shares below describe |
| `sand_coverage_pct` | % of strip | Loose sand near the road: more sand available to move |
| `vegetation_coverage_pct` | % of strip | Plants hold sand in place: more vegetation, lower risk |
| `bare_soil_pct` | % of strip | Bare soil/gravel; shown for context, not used in the rule |
| `distance_to_road_m` | m | Gap between the nearest sand front and the road edge |
| `weather.temperature_c` | °C | Context only |
| `weather.humidity_pct` | % RH | Context only (dry air keeps sand loose, but this is not modelled) |
| `weather.wind_speed_mps` | m/s | Wind is what moves sand toward the road |

Sand, vegetation and bare soil are shares of the same strip; the rest up to 100 % is "other"
(asphalt, buildings, shadow).

### The three scenarios

| | 1 · Low | 2 · Medium | 3 · High |
|---|---|---|---|
| Wind speed | 3.2 m/s | 6.8 m/s | 11.5 m/s |
| Temperature | 31 °C | 36 °C | 41 °C |
| Humidity | 38 % | 25 % | 14 % |
| Sand coverage | 18 % | 42 % | 68 % |
| Vegetation | 22 % | 12 % | 4 % |
| Bare soil | 52 % | 40 % | 24 % |
| Sand front to road | 120 m | 45 m | 8 m |
| Observation date | 2026-10-04 | 2026-10-11 | 2026-10-19 |
| Demo indicator | 17 → Low | 56 → Medium | 91 → High |

This is a separate, illustrative dataset about a real road corridor (future satellite and
weather inputs). It is **not** part of `shared_mock_data.json`. Its "field wind" (e.g. 6.8 m/s)
is intentionally different from the prototype's `wind_01` sensor (e.g. 6.0 m/s): one is
weather at a real road, the other is the fan wind inside the box. Selecting a scenario updates
the weather cards, satellite bars, the strip above the road (sand front, shrubs) and the demo
indicator together with the shared readings.

### Demo risk indicator (illustrative rule)

A transparent weighted score in `js/environmentRule.js`, settings in `CONFIG.DEMO_RULE`:

```
score = 100 × (0.30 × wind + 0.30 × sand coverage + 0.25 × closeness + 0.15 × lack of vegetation)
```

Each factor is scaled to 0–1 in a straight line:

| Factor | 0 at | 1 at | Weight |
|---|---|---|---|
| Wind speed | ≤ 3 m/s | ≥ 12 m/s | 0.30 |
| Sand coverage | 0 % | ≥ 80 % | 0.30 |
| Sand-to-road distance | ≥ 150 m | ≤ 5 m | 0.25 |
| Vegetation (less = higher) | ≥ 30 % | 0 % | 0.15 |

The score is classified with `RISK_BANDS` (0–30 Low, 31–60 Medium, 61–100 High).
The dashboard shows each factor's points and a one-line reason.

**Important:**
- This rule only shows how several variables *could* feed a risk assessment. It is not
  validated and it is **not** the future AI prediction model, which will be trained on real data.
- Temperature and humidity are **not** used, and neither one alone decides road risk.
- The main **Risk level** (top right) is the preset label from `shared_mock_data.json`.
  The demo indicator is a separate, explanatory value.

### Plugging in real data later

All environment data goes through one function in `app.js`:

```js
applyEnvironmentData(record)   // validates with normalizeEnvironmentData(), then redraws
```

Today `SampleEnvironmentProvider.load(scenarioKey)` supplies the record. To use real data,
keep the same schema and either write a new provider with a `load()` method (set
`environmentProvider` in `app.js`) or call `applyEnvironmentData()` when data arrives:
- **Satellite:** land-cover shares and sand-front distance computed per road segment
  (e.g. Sentinel-2 / Dynamic World in Google Earth Engine, exported by Python).
- **Weather:** observations or historical data (e.g. ERA5-Land) for the same date and place.
- **Python backend:** send the record as a JSON message over the existing WebSocket.

Search the code for **`[FUTURE DATA INTEGRATION POINT]`**. The dashboard reads only the
schema, never the provider. In Live Sensor Mode no environment source is connected, so the
panel says so and shows no values.

---

---

## 6. Experiment log & CSV

- One row per reading while the status is **running**.
- CSV columns: `run_id, received_at, mode, scenario_id, preset_risk_level`, then the six contract
  fields `timestamp, sensor_id, value, unit, source, status` exactly as received.
- `timestamp` is the reading's own time from the file (2026-10-22T12:00:00Z for all scenarios);
  `received_at` is when the dashboard received it.
- The log lives in browser memory: refreshing the page clears it. Export before closing.

---

## 7. Connecting the Python backend (PRO-06) and real sensors

### A. Scenarios from the PRO-06 API (planned)
The shared README asks PRO-06 to serve the same file, e.g. `GET /api/scenarios/<scenario_id>`
(not agreed yet; the existing random `/api/readings` must not be used for this display).
When it exists, set in `js/config.js`:
```js
SCENARIO_API_BASE: "http://localhost:5000",
```
The dashboard then fetches the selected scenario from the API, validates it against the same
contract and shows "PRO-06 API" as the data origin. If the API is down or breaks the contract,
the run stops and the problem is shown. (The backend must allow the request with CORS.)

### B. Live sensors over WebSocket
`CONFIG.LIVE_BACKEND_URL` is `null`, so Live mode shows "Hardware not connected / not configured"
and never invents readings. When a backend sends readings, it must use the six-field contract,
one reading or a list per message:
```json
{ "timestamp": "2026-10-23T11:00:00Z", "sensor_id": "sand_01", "value": 2.1,
  "unit": "cm", "source": "live", "status": "ok" }
```
Readings with wrong fields, unknown sensor IDs or wrong units are ignored.
**Open point:** v1.0 only defines `source: "scenario"`. `"live"` is a proposal to agree with
PRO-06 in a v2.0 file.

`python/bridge.py` is a reference template (Arduino lines `sand_01,2.4` or
`{"sensor_id": "wind_01", "value": 6.1}` → WebSocket + CSV in contract format). PRO-06 owns
the real backend.

Search the code for **`[PYTHON INTEGRATION POINT`** and **`[FUTURE DATA INTEGRATION POINT]`**.

---

## 8. What was tested

Tested in Chromium on 23 Oct 2026:
- Shared file loaded from `data/shared_mock_data.json` via a local server, and from the embedded
  copy when opened by double-click; banner shows the origin; `--check` confirms the copy matches.
- Low / Medium / High show exactly 2.0 / 6.0 / 11.0 m/s, 0.5 / 2.5 / 5.0 cm and the preset labels;
  switching scenario mid-run updates readings, field data and demo indicator together.
- Start, Stop (values hold, no new rows), Resume (same run), Reset (cleared, log kept).
- CSV export: one row per reading with the six contract fields unchanged.
- Future API path with a local test server: valid scenario shown; a reading with a wrong unit is
  rejected and the run stops with the reason.
- Live mode without backend: "not configured", Start refused. With `bridge.py` and a virtual serial
  port: contract readings shown, invalid line ignored, risk "Not classified", START/STOP forwarded.
- Phone width (390 px): no horizontal scrolling.

## 9. Known limitations

- All values are illustrative. The shared file has one reading per sensor per scenario, so a run
  repeats the same values; it does not show sand building up over time.
- The road picture scale (6 cm = full road) is a display choice, not part of the shared data.
- No cm thresholds are agreed, so live readings are not classified.
- The PRO-06 scenario endpoint and a `source` value for live readings are not agreed yet.
- `bridge.py` has not been tested with a real Arduino/ESP32.
- The field data sample (satellite + weather) is separate illustrative data; its wind differs
  from `wind_01` on purpose. The demo rule's weights are not calibrated.
- The browser log is cleared when the page is refreshed.
- No AI map or prediction model is included (out of scope for PRO-01).
