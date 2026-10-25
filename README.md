# Sand Encroachment Monitoring System — PRO-01 Digital Demo & Dashboard

A browser dashboard for the physical prototype (a road inside a box with sand, a wind fan
and sensors). It plays fixed demo scenarios from the team's **shared mock data** file and is
ready to show real Arduino readings. A separate **Satellite Monitoring** section analyses
real Sentinel-2 images of the team's three **research routes** (Routes 3, 4 and 5, from the
KMZ study-area files) for sand cover (section 10).

## Current scope

| Part | Status | Role |
|---|---|---|
| **Road simulation** (Low / Medium / High) | Included | **Main feature.** Animated road, readings, preset risk label, log, CSV. |
| **Live Arduino mode** | Included, ready for hardware | Same road view fed by real `sand_01` / `wind_01` readings via `python/bridge.py` → WebSocket. |
| **Satellite Monitoring** (Sentinel-2) | Included, optional | **Supporting view** at the bottom of the page. Real images of the research routes (KMZ), kept separate from the prototype. |
| Machine learning / future prediction | **Not included** | A separate future phase. No model, forecast or prediction algorithm is in this dashboard. |

Rules this version follows:
- Satellite values are **never** turned into Arduino sensor readings, never drawn on the road
  simulation and never feed the risk label or the demo indicator.
- Every value is labelled by origin: **Simulated readings** (Scenario / Demo), **Live Arduino
  readings** (bridge connected) or **Real Sentinel-2 … satellite-derived** (satellite section).
- The page keeps working when the Arduino, the bridge or the satellite backend is not there:
  Scenario / Demo and the cached satellite images need nothing but the browser.
- The "demo risk indicator" in the Field data panel is an illustrative weighted rule for the
  sample scenarios only. It is not a prediction and is not calculated for satellite data.

> **Scenario / Demo values are illustrative**, not real sensor readings. Risk levels are preset
> display labels, not outputs of a trained model or validated thresholds.
> **Satellite Monitoring is real data** from the Sentinel-2 satellites. It describes real roads,
> not the prototype box, and is never shown as a `sand_01` / `wind_01` reading.

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

If the buttons do not respond after updating the files, reload with **Cmd+Shift+R**
(Ctrl+F5 on Windows) so the browser drops old cached copies. Any part that fails to start is
named in a red line under the title instead of failing silently.

No internet or backend is needed either way: the Satellite Monitoring section shows the
**cached** real Sentinel-2 analyses in `data/satellite/` offline.

**Live Arduino readings (when the hardware is plugged in):**
```bash
pip install -r python/requirements.txt
python3 python/bridge.py --list-ports            # find the Arduino's port
python3 python/bridge.py --port <port>           # then Live Sensor → Start in the dashboard
```
See section 7B.

**Live satellite analysis (optional, needs internet):**
```bash
pip install -r python/requirements.txt
python3 python/satellite_server.py       # then open http://localhost:8780
```
See section 10 for Copernicus credentials and the offline cache.

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
│   ├── environmentData.js     Field data SAMPLE (satellite + weather) + record checks
│   ├── environmentRule.js     Demo multi-variable indicator + explanation
│   ├── satellite.js           Satellite Monitoring section (cached + live Sentinel-2)
│   ├── logger.js              Experiment log + CSV export
│   ├── dashboard.js           Drawing: updateDashboard(sensorData) and helpers
│   └── app.js                 State + button logic; connects everything
├── python/
│   ├── sync_shared_data.py    Regenerates / checks js/sharedMockData.js
│   ├── bridge.py              Reference Arduino → WebSocket template (PRO-06 owns the backend)
│   ├── satellite_server.py    Flask API for live Sentinel-2 analysis (port 8780)
│   ├── satellite_cache.py     Command line: pre-cache analyses for offline demos
│   ├── import_routes.py       KMZ research routes → GeoJSON + segments (routes.json)
│   ├── satellite/             providers (CDSE, AWS), processing, routes, roads, analysis, cache
│   ├── tests/                 Offline unit tests for the satellite pipeline
│   └── requirements.txt
└── data/
    ├── shared_mock_data.json          CANONICAL shared mock data v1.0 (unchanged)
    ├── SHARED_MOCK_DATA_README.txt    Rules that came with it
    ├── sample_reading.json            Example of the dashboard's data object
    ├── sample_environment_scenarios.json  Field data sample (copy of the JS)
    ├── sample_backend_message.json    Example live message (contract format)
    └── satellite/
        ├── routes/source/*.kmz        ORIGINAL research-route KMZ files (Routes 3, 4, 5)
        ├── routes/<route>.geojson     Centreline + 2 km study area, coordinates unchanged
        ├── routes.json                GENERATED: routes, validation report, segments
        ├── cache/<segment>/<date>/    original.jpg, overlay.jpg, result.json (real analyses)
        └── cache_manifest.js          GENERATED list of cached analyses (works offline)
```

### How the files work together

```
 shared_mock_data.json ─► scenarioData.js (load + validate)
                                  │
 [Start/Stop/Reset, scenario] ─► app.js ◄── dataSources.js (Scenario or Live readings)
                                  │
                                  ├─► logger.js     one CSV row per reading
                                  └─► dashboard.js  updateDashboard(sensorData)

 Sentinel-2 ─► python/satellite (server or cache) ─► cache_manifest.js / API
                                  │
                                  └─► satellite.js ─► Satellite Monitoring section
                                           └─► applyEnvironmentData() ─► Field data panel
                                               (only when "Sentinel-2 analysis" is selected)
```
The satellite path never touches the sensor readings, the risk pills or the experiment log.

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

The tag at the top right of the road panel always says where the numbers come from:
**Simulated readings** (Scenario / Demo), **Live Arduino readings** (real readings arriving) or
**Live · no sensor data** (Live mode, nothing received yet). The note under the risk panel
changes with it.

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

## 5. Field data panel (sample scenario or Sentinel-2 analysis)

The panel has a source switch:

| Source | What it shows | Badge |
|---|---|---|
| **Sample scenario** (default) | The hand-written sample below, following Low / Medium / High | "Sample data · not real…" (amber) |
| **Sentinel-2 analysis** | The analysis currently shown in Satellite Monitoring (section 10). It stays put when the scenario changes. | "Real Sentinel-2 data · satellite-derived, not from the prototype" (blue) |

The second option unlocks once an analysis is shown (cached analyses load at start), or with
**Use in Field data panel**. With Sentinel-2 the weather cards show "—": the satellite does not
measure weather, no weather service is connected, and the prototype's `wind_01` is not used.

With Sentinel-2 selected the demo indicator shows **Not scored**: satellite values are shown for
reference only, without a risk score. The strip above the road in the simulation is drawn only
from the sample data and says "not drawn (satellite data has its own section)" otherwise.

### Sample data

> **SAMPLE DATA — NOT REAL SENSOR OR SATELLITE MEASUREMENTS.**
> The values are hand-written examples for an arid road corridor in Saudi Arabia.
> No satellite imagery is behind these numbers and no weather service is called.
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

The indicator is calculated **only for the sample scenarios**. Sentinel-2 analyses and live
Arduino readings are not scored. (`assessEnvironmentalIndicator()` still never guesses a
missing input: it would label a score "partial", but the dashboard no longer passes satellite
data to it.)

**Important:**
- This rule only shows how several variables *could* feed a risk assessment. It is not
  validated, it is **not** a prediction, and machine learning is a separate future phase that
  is not part of this dashboard.
- Temperature and humidity are **not** used, and neither one alone decides road risk.
- The main **Risk level** (top right) is the preset label from `shared_mock_data.json`.
  The demo indicator is a separate, explanatory value.

### Plugging in real data later

All environment data goes through one function in `app.js`:

```js
applyEnvironmentData(record)   // validates with normalizeEnvironmentData(), then redraws
```

`SampleEnvironmentProvider.load(scenarioKey)` supplies the sample record. Sentinel-2 analyses
are converted to the same schema by `satelliteResultToEnvironment()` in `js/satellite.js`
(`data_source: "sentinel-2"`, `data_kind: "satellite-derived"`, unknown values `null`).
Still open:
- **Weather:** observations or historical data (e.g. ERA5-Land) for the same date and place.
- **Python backend:** send the record as a JSON message over the existing WebSocket.

Search the code for **`[FUTURE DATA INTEGRATION POINT]`** and **`[SATELLITE INTEGRATION POINT]`**.
The dashboard reads only the schema, never the provider. In Live Sensor Mode the sample is not
shown (no field source for real sensors); a Sentinel-2 analysis can still be selected because it
describes a real road, not the box.

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

### B. Live Arduino sensors over WebSocket

**Steps with the hardware:**
```bash
pip install -r python/requirements.txt          # pyserial + websockets
python3 python/bridge.py --list-ports            # find the Arduino, e.g. /dev/cu.usbmodem1101
python3 python/bridge.py --port /dev/cu.usbmodem1101    # options: --baud 9600 --ws-port 8765
```
Then open the dashboard, choose **Live Sensor** and press **Start**. The Arduino prints one
reading per line, either `sand_01,2.4` or `{"sensor_id": "wind_01", "value": 6.1}`.

`CONFIG.LIVE_BACKEND_URL` defaults to `ws://localhost:8765`, the bridge's address (set it to
`null` to switch Live mode off). How the dashboard behaves:

| Situation | What you see |
|---|---|
| Bridge not running | "Could not reach ws://localhost:8765. Is bridge.py running?" No values are shown. |
| Connected, readings arriving | Tag **Live Arduino readings**, values and road update, rows logged. |
| Connected, no reading for 10 s (`LIVE_STALE_AFTER_MS`) | Amber "Live: connected, no readings" with a hint to check the cable, port and sketch. Clears when readings return. |
| Bridge stopped during a run | Reconnects automatically (3 tries, 2 s apart: `LIVE_RECONNECT_ATTEMPTS`, `LIVE_RECONNECT_DELAY_MS`), then stops with a clear message. |
| USB cable pulled | `bridge.py` prints "Serial connection lost" and stops; restart it. |

Start / Stop / Reset are forwarded to the Arduino as `START` / `STOP` / `RESET` lines.
Scenario / Demo keeps working the whole time; switching modes resets the run.

Readings must use the six-field contract, one reading or a list per message:
```json
{ "timestamp": "2026-10-23T11:00:00Z", "sensor_id": "sand_01", "value": 2.1,
  "unit": "cm", "source": "live", "status": "ok" }
```
Readings with wrong fields, unknown sensor IDs or wrong units are ignored.
**Open point:** v1.0 only defines `source: "scenario"`. `"live"` is a proposal to agree with
PRO-06 in a v2.0 file.

`python/bridge.py` also writes every reading to a CSV in contract format. PRO-06 owns the
real backend; the bridge is the reference for the message format.

Search the code for **`[PYTHON INTEGRATION POINT`** and **`[FUTURE DATA INTEGRATION POINT]`**.

---

## 8. What was tested

Research routes, tested on 25 Oct 2026 (Chromium + Python 3):
- `python -m unittest discover -s tests` (in `python/`): 15 offline tests. New: every centreline
  and study-area vertex equals the KMZ; all three routes pass validation (half-width ≈ 2 km);
  swapped lat/lon, an open polygon and a shifted centreline are rejected; segments run from
  km 0 to the end without gaps; Route 4's segment areas cover its study area exactly with no
  overlap; measurements ignore sand outside the analysis area; a zone-edge segment (Route 5,
  48° E) falls back to an existing Sentinel-2 tile. Every cached result belongs to a route segment.
- Real imagery: 12 segments analysed from the AWS archive (all three routes, incl. the
  segments either side of the UTM zone boundary); overlays checked by eye: the KMZ centreline
  lies on the visible road.
- Browser, cached and live: route and segment pickers (31 / 9 / 66 segments), only cached
  segments enabled offline, route / segment / date / analysis area shown, Field data panel,
  buffer validation (10–2000 m), live analysis of a new segment with a 300 m buffer, backend
  offline message, demo locations gone, simulation and log unchanged, no horizontal scroll at
  390 px.

Scope refinement, tested on 25 Oct 2026 (Chromium, real mouse clicks):
- Every control clicked by double-click (`file://`) and via `http.server`: Start, Stop, Resume,
  Reset, Low / Medium / High (also mid-run), both sensor modes, CSV export, Clear log, Field data
  source switch and all satellite controls. No control is covered by another element at six
  window widths; no horizontal scrolling at 390 px.
- Scenario values and demo scores are unchanged from `main` (0.5 / 2.5 / 5 cm, 2 / 6 / 11 m/s,
  scores 17 / 56 / 91). Labels: "Simulated readings" in Scenario / Demo.
- Satellite isolation: with Sentinel-2 selected the indicator says "Not scored", the road strip
  is not drawn from satellite data, and no satellite value reaches the readings, risk or log.
- Live mode without the bridge: honest "Is bridge.py running?" message, no values.
- Live mode with `bridge.py` on a virtual serial port: readings tagged "Live Arduino readings",
  risk "Not classified", START / STOP forwarded, the no-readings warning appears and clears,
  automatic reconnect after the bridge is restarted, a clear message after the retries run out,
  and Scenario / Demo works normally afterwards.
- Satellite backend offline: cached images work, Live analysis shows "backend not reachable".

Satellite integration, tested on 25 Oct 2026 (Chromium + Python 3):
- `python -m unittest discover -s tests` (in `python/`): 8 offline tests. Synthetic scenes check
  sand vs gravel vs vegetation, clouds excluded (not counted as sand), speckle removed, road
  distance (sand 300 m from a road → 300 m) and road-strip coverage, road outside the area
  rejected; the Copernicus provider with the network mocked (request format, nearest scene,
  GeoTIFF parsing); every cached result and road file is complete and valid.
- Real imagery: 6 Sentinel-2 L2A scenes downloaded from the public AWS archive and analysed
  (3 highway segments); overlays checked by eye against the true-colour images.
- Live path: `satellite_server.py` downloaded and analysed a new scene (2026-10-05) from the
  browser; a custom point without road geometry gave sand cover with distance "—" and the reason.
- Offline: opened by double-click with no backend: cached analyses, date switching and the Field
  data link work; Live shows "backend not reachable" instead of values.
- Regression: the scenario, field-data and live-bridge browser tests from 23 Oct were re-run on
  this branch and on `main`; results are identical (CSV contents, risk labels, values, scores).
- Phone width (390 px): no horizontal scrolling.
- Start-up robustness: every control clicked with real mouse events (Start, Stop, Reset,
  Low / Medium / High, both sensor modes, CSV export, Clear log, all satellite controls) by
  double-click, `http.server` and `satellite_server.py`, with the backend online and offline;
  also with `satellite.js` missing and with an outdated cached `index.html`: the experiment
  controls keep working and the problem is shown on the page.

Copernicus Data Space (CDSE) itself could not be reached from the test machine; its code path
is covered by the mocked test only. Check it once with your own credentials (section 10).

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
- `bridge.py` has been tested with a virtual serial port, not yet with a real Arduino/ESP32.
- The field data sample (satellite + weather) is separate illustrative data; its wind differs
  from `wind_01` on purpose. The demo rule's weights are not calibrated.
- The browser log is cleared when the page is refreshed.
- No machine learning, AI map or prediction model is included. That is a separate future phase.
- Satellite sand detection is rule-based and not validated against field data; see
  "Limitations" in section 10.

---

## 10. Satellite monitoring (real Sentinel-2)

### Research routes (source: KMZ files)

The section analyses only the team's research routes. Each KMZ holds the road centreline and the
study area, 2 km on each side of it. The files are kept unchanged in
`data/satellite/routes/source/` and imported with `python3 python/import_routes.py`.

| Route | KMZ file | Centreline | Length | Segments | Study area |
|---|---|---|---|---|---|
| **Route 3: Al-Ahsa – Salwa** | `Al_Ahsa_Salwa_Route3_2km_Study_Area.kmz` | "Route 3 - original GeoJSON line", 662 points | 152.7 km | 31 × ~4.9 km | 1,255-point polygon, 2 km each side |
| **Route 4: Abqaiq – Salasil** | `Abqaiq_Salasil_Route4_2km_Study_Area.kmz` | "Abqaiq–Salasil route-4", 283 points | 46.2 km | 9 × ~5.1 km | 682-point polygon, 2 km each side |
| **Route 5: Al-Ahsa – Riyadh** | `Al_Ahsa_Riyadh_Route5_2km_Study_Area.kmz` | "Road centerline (source route-5.geojson)", 1,383 points | 327.6 km | 66 × ~5.0 km | 3,332-point polygon, 2 km each side |

Lengths are measured along the centreline in UTM (zone 39N; Route 5 also 38N west of 48° E).
Chainage (km) starts at the first point of each line: Al-Ahsa for Routes 3 and 5, Abqaiq for
Route 4. The two Route 4 files that were supplied are identical (same SHA-256); one copy is kept.

**What the import does (`python/satellite/routes.py`)**
1. Reads the single `doc.kml` in each KMZ: exactly one LineString (centreline) and one Polygon
   (study area). Coordinates are copied **unchanged** into `routes/<route>.geojson`; only the
   altitude (always 0) is dropped. A unit test compares every vertex with the KMZ.
2. **Validates before anything is written:** KML lon/lat (EPSG:4326) inside Saudi Arabia (catches
   swapped lat/lon or another CRS); altitudes all 0; closed polygon without holes; every
   centreline point inside the study area; study-area half-width ≈ 2 km (measured: medians
   2000 / 2000 / 2002 m, range 1997–2004 m); reprojection to UTM round-trips exactly.
3. Cuts each centreline into equal **segments of about 5 km** (`--segment-km` to change). Each
   segment gets one image: the box (in the UTM zone of its midpoint, on the 10 m Sentinel-2 grid)
   around everything within 2.1 km of the segment, about 5–9 km a side.
4. The **analysis area** of a segment is its part of the KMZ study area: pixels inside the
   polygon that are closer to this segment than to the rest of the route. Neighbouring segments
   never share a pixel and together cover the whole polygon (tested on Route 4: 187.995 km²).

### What an analysis does
1. Pick a **route**, a **segment** (km along the route) and an **observation date**.
2. Before downloading, the segment geometry is checked (image on the grid and in the right UTM
   zone, study area and road inside the image).
3. The backend finds the nearest **clear** Sentinel-2 Level-2A scene (≤ 30 % tile cloud,
   within ± 15 days) and reads bands B02, B03, B04, B08, B11, B12 and the Scene Classification
   Layer (SCL) at 10 m. At least 90 % of the analysis area must have data. Near a tile or UTM
   zone edge the image is completed from the neighbouring tile of the same pass (reprojected
   when it is in the other zone); the tiles used are saved in `scene.mosaic_tiles`.
4. Sand is detected (method below) and measured **inside the analysis area only**.
5. The dashboard shows the **original** true-colour image beside the **overlay**: sand pink,
   KMZ centreline yellow, the segment's 2 km study area outlined in cyan (outside it darkened),
   the road buffer in white, cloud / water / no-data grey. It names the route, segment, scene
   date and analysis area.
6. **Use in Field data panel** sends the study-area values to the Environmental panel (section 5).

| Source switch | Needs | Notes |
|---|---|---|
| **Cached (offline)** (default) | nothing | Reads `data/satellite/cache_manifest.js`; works by double-click. Only cached segments can be picked. |
| **Live (Python backend)** | `satellite_server.py` + internet | Any segment, any date, road buffer 10–2000 m; also a custom lat/lon point (not a research route). Result is added to the cache. |

**Road buffer:** the main values cover the 2 km study area. A smaller strip beside the road
(default **200 m**, `CONFIG.SATELLITE_ROAD_BUFFER_M`, `?buffer_m=`, `--buffer-m`) gives extra
measurements: sand, vegetation and bare-soil shares within that distance of the centreline.

### Included cached analyses (real imagery)

| Route | Segment | Scene (tile) | Analysis area | Sand, 2 km study area | Sand within 200 m | Nearest sand | Clear |
|---|---|---|---|---|---|---|---|
| Route 3: Al-Ahsa – Salwa | 1 of 31 · km 0.0–4.9 | 2026-10-20 (39RUJ) | 23.13 km² | 4.0 % | 1.4 % | 60 m | 100.0 % |
| Route 3: Al-Ahsa – Salwa | 16 of 31 · km 73.9–78.8 | 2026-10-20 (39RVH) | 19.72 km² | 68.4 % | 28.3 % | 40 m | 100.0 % |
| Route 3: Al-Ahsa – Salwa | 30 of 31 · km 142.9–147.8 | 2026-10-20 (39RVH) | 19.76 km² | 36.6 % | 7.1 % | 40 m | 54.3 % |
| Route 4: Abqaiq – Salasil | 1 of 9 · km 0.0–5.1 | 2026-10-20 (39RUJ) | 25.77 km² | 18.2 % | 12.6 % | 20 m | 100.0 % |
| Route 4: Abqaiq – Salasil | 3 of 9 · km 10.3–15.4 | 2026-10-08 (39RUJ) | 20.54 km² | 46.4 % | 20.3 % | 10 m | 100.0 % |
| Route 4: Abqaiq – Salasil | 5 of 9 · km 20.5–25.7 | 2026-10-18 (39RUJ) | 20.66 km² | 40.4 % | 32.8 % | 10 m | 100.0 % |
| Route 4: Abqaiq – Salasil | 9 of 9 · km 41.1–46.2 | 2026-10-18 (39RUJ) | 25.68 km² | 43.8 % | 8.9 % | 40 m | 100.0 % |
| Route 5: Al-Ahsa – Riyadh | 1 of 66 · km 0.0–5.0 | 2026-10-20 (39RUJ) | 23.71 km² | 14.8 % | 11.0 % | 10 m | 100.0 % |
| Route 5: Al-Ahsa – Riyadh | 29 of 66 · km 139.0–144.0 | 2026-10-18 (39RTH) | 19.88 km² | 95.4 % | 75.4 % | 10 m | 100.0 % |
| Route 5: Al-Ahsa – Riyadh | 34 of 66 · km 163.8–168.8 | 2026-10-18 (38RQN) | 20.12 km² | 92.2 % | 82.3 % | 0 m | 100.0 % |
| Route 5: Al-Ahsa – Riyadh | 35 of 66 · km 168.8–173.7 | 2026-10-18 (38RQN) | 19.53 km² | 79.4 % | 77.8 % | 0 m | 100.0 % |
| Route 5: Al-Ahsa – Riyadh | 66 of 66 · km 322.7–327.6 | 2026-10-21 (38RPN) | 25.83 km² | 1.8 % | 1.0 % | 0 m | 100.0 % |

Route 3 segment 30 reaches the Gulf of Salwa: the sea in its study area is water, not counted (54 % clear).
Route 5 segments 34 and 35 lie either side of the 48° E UTM zone boundary.

Values come from `result.json` in each cache folder (rule-based estimates, see below). Other
segments: switch to Live, or cache them with `satellite_cache.py` (below).

### Setup
```bash
pip install -r python/requirements.txt     # numpy, scipy, rasterio, Pillow, requests, flask, mgrs
python3 python/satellite_server.py         # http://localhost:8780 (dashboard + API)
```
The page also works from `index.html` by double-click; it calls `CONFIG.SATELLITE_API_BASE`
(`http://localhost:8780`) only when **Live** is used.

### Credentials and configuration

| What | Needed? | How |
|---|---|---|
| **Copernicus Data Space Ecosystem** OAuth client | Recommended (preferred provider) | 1. Create a free account at <https://dataspace.copernicus.eu>. 2. Open the Sentinel Hub dashboard <https://shapps.dataspace.copernicus.eu/dashboard/> → **User settings** → **OAuth clients** → **Create**. 3. Copy the client ID and secret (the secret is shown once). 4. Set them before starting the server: `export CDSE_CLIENT_ID=…` and `export CDSE_CLIENT_SECRET=…` (Windows: `set CDSE_CLIENT_ID=…`). Free accounts have a monthly processing quota. |
| No credentials | Works | Falls back to the public **AWS Open Data** Sentinel-2 L2A archive (Element 84 COGs), no account. |
| Road geometry | Included | Research routes: the KMZ centrelines and study areas. Updated KMZ: replace the file in `routes/source/` and run `python3 python/import_routes.py`. Custom points (Live only) try OpenStreetMap and save it as `data/satellite/roads/<id>.geojson`. |
| Proxy / company network | Only if HTTPS fails | Set `REQUESTS_CA_BUNDLE` (and `CURL_CA_BUNDLE` for GDAL) to your CA file. |
| `js/config.js` | Optional | `SATELLITE_API_BASE`, `SATELLITE_DEFAULT_SOURCE` (`"cache"`/`"live"`), `SATELLITE_REQUEST_TIMEOUT_MS`, `SATELLITE_ROAD_BUFFER_M`. |

The server shows which provider it uses at start-up and in `GET /api/satellite/status`.
Force one with `?provider=cdse|aws` or `satellite_cache.py --provider cdse`.

### Offline cache
```bash
python3 python/import_routes.py                                  # after changing a KMZ
python3 python/satellite_cache.py --list-segments                # routes, segments, km, centres
python3 python/satellite_cache.py --route 3 --segments 1,16,30   # default date 2026-10-20
python3 python/satellite_cache.py --route 5 --segments 29 --date 2026-07-15 --buffer-m 500
python3 python/satellite_cache.py --route 4 --all-segments       # a whole route
python3 python/satellite_cache.py                                # refresh everything cached
python3 python/satellite_cache.py --list                         # what is cached
python3 python/satellite_cache.py --manifest-only                # rebuild cache_manifest.js
```
Each run writes `data/satellite/cache/<segment>/<scene date>/` (about 0.4 MB) and regenerates
`cache_manifest.js`. Run it before a demo (or analyse live once); the images then show without
internet.

### API (`satellite_server.py`)
| Request | Returns |
|---|---|
| `GET /api/satellite/status` | provider, whether CDSE is configured, cached analyses, routes |
| `GET /api/satellite/routes` (also `/locations`) | routes with their segments (`routes.json`) |
| `GET /api/satellite/analysis?segment=<id>&date=YYYY-MM-DD[&buffer_m=200]` | runs a live analysis (saved to cache); `location=<id>` also works |
| `…&mode=cache` | the cached result for that scene date, or 404 |
| `GET /api/satellite/analysis?lat=..&lon=..&date=..` | custom point (road from OpenStreetMap if reachable) |

Segment ids look like `route3_al_ahsa_salwa_s16`. Errors come back as `{"error", "hint"}`
(400 bad input, 422 no usable scene or invalid geometry, 502 network, 404 unknown).

### Sand detection method (`python/satellite/processing.py`)
1. **Valid pixels:** SCL removes no-data, saturated, cloud (medium / high), cirrus, cloud shadow
   and water. All percentages are shares of valid pixels, so clouds never count as sand or as
   "no sand".
2. **Colour segmentation:** true colour → HSV. Sand must have hue 8–48° (yellow-orange-red,
   iron-coated dune sand) and saturation above a threshold.
3. **Thresholding:** the saturation threshold is found per image with **Otsu's method** and kept
   within 0.45–0.65. Also Bare Soil Index > 0, NDVI < 0.15 and mean visible reflectance ≥ 0.15
   (removes asphalt, shadow and dark sabkha). Vegetation = NDVI ≥ 0.25.
4. **Texture analysis:** local standard deviation of red reflectance in a 5 × 5 px (50 m)
   window ≤ 0.015. Loose sand is smooth; rock outcrops, buildings and earthworks are rough.
   Sand pixels next to smooth sand keep their label (the window straddles the edge there).
5. **Morphology:** opening, closing, then removal of patches and holes smaller than 25 px
   (0.25 ha).

All parameters are listed at the top of `processing.py` and saved in every `result.json`.

### Measurements (`result.json` → `measurements`)
| Field | Meaning |
|---|---|
| `area_sand_coverage_pct`, `area_vegetation_pct`, `area_other_bare_pct` | Shares of valid pixels in the **analysis area**: the segment's part of the 2 km study area (whole image for a custom point) |
| `area_km2`, `image_km2` | Size of the analysis area and of the image |
| `sand_coverage_pct`, `vegetation_coverage_pct`, `bare_soil_pct` | The same within `buffer_m` (road buffer) of the centreline, inside the analysis area; bare soil = other bare ground (gravel, rock, sabkha, paved) |
| `distance_to_road_m` | Distance from the road **centreline** to the nearest detected sand pixel in the analysis area, in 10 m steps. `0` = sand in the centreline pixel; on a divided highway this includes a sandy median. |
| `valid_pct`, `cloud_pct` | Share of the analysis area that was usable / cloudy (water, e.g. the sea at Salwa, is not usable) |

`result.json` also records `route`, `segment` (index, km from–to), `analysis_area` and the
`road` source (KMZ). For a custom point without valid road geometry the buffer values and
distance are `null` with `distance_to_road_m_reason`.

### Honesty rules built in
- Every number comes from Sentinel-2 pixels; nothing is filled in or simulated. Unknown = `null` → "—".
- Satellite results are labelled "Real Sentinel-2 … not measured by the physical prototype",
  carry the scene ID and date, and never appear as `sand_01` / `wind_01`, in the risk pills or
  in the experiment log. The Low / Medium / High simulation and Live Sensor Mode are unchanged.
- Contains modified Copernicus Sentinel data (attribution saved in each result).

### Limitations
- Rule-based detection, not validated against field surveys. Pale sand, sabkha and caprock with
  sand-like colour can be confused; mixed 10 m pixels blur edges. Treat values as estimates.
- Road and study area are exactly as in the KMZ files; their accuracy is that of the KMZ. The
  centreline is one line per route, so on a divided highway the distance is to that line.
- Only 12 of the 106 segments are cached; the others need Live (internet) or `satellite_cache.py`.
- Distance is measured to the centreline, not the paved edge (road width is not known).
- 10 m pixels cannot see a thin sand film on asphalt; the result describes sand around the road.
- The scene is the nearest clear one to the chosen date (the date used is always shown).
- No weather data is attached to satellite results.
