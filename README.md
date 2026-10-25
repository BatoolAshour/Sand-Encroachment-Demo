# Sand Encroachment Monitoring System — PRO-01 Digital Demo & Dashboard

A browser dashboard for the physical prototype (a road inside a box with sand, a wind fan
and sensors). It plays fixed demo scenarios from the team's **shared mock data** file and is
ready to show real Arduino readings. A separate **Satellite Monitoring** section analyses
real Sentinel-2 images of Saudi highways for sand cover (section 10).

## Current scope

| Part | Status | Role |
|---|---|---|
| **Road simulation** (Low / Medium / High) | Included | **Main feature.** Animated road, readings, preset risk label, log, CSV. |
| **Live Arduino mode** | Included, ready for hardware | Same road view fed by real `sand_01` / `wind_01` readings via `python/bridge.py` → WebSocket. |
| **Satellite Monitoring** (Sentinel-2) | Included, optional | **Supporting view** at the bottom of the page. Real images of real roads, kept separate from the prototype. |
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
│   ├── satellite/             providers (CDSE, AWS), processing, roads, analysis, cache
│   ├── tests/                 Offline unit tests for the satellite pipeline
│   └── requirements.txt
└── data/
    ├── shared_mock_data.json          CANONICAL shared mock data v1.0 (unchanged)
    ├── SHARED_MOCK_DATA_README.txt    Rules that came with it
    ├── sample_reading.json            Example of the dashboard's data object
    ├── sample_environment_scenarios.json  Field data sample (copy of the JS)
    ├── sample_backend_message.json    Example live message (contract format)
    └── satellite/
        ├── locations.json             Demo road segments (id, name, centre, size, default date)
        ├── roads/<id>.geojson         Road centrelines used for distance + road strip
        ├── cache/<id>/<date>/         original.png, overlay.png, result.json (real analyses)
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

### What it does
1. Pick a **location** (road segment, 5 × 5 km) and an **observation date**.
2. The backend finds the nearest **clear** Sentinel-2 Level-2A scene (≤ 30 % tile cloud,
   within ± 15 days), cuts out the area at 10 m and reads bands B02, B03, B04, B08, B11, B12
   and the Scene Classification Layer (SCL).
3. Sand is detected (method below) and measured.
4. The dashboard shows the **original** true-colour image beside the **sand-detection overlay**
   (sand pink, road yellow, analysis strip white, cloud / water / no-data grey) and the numbers.
5. **Use in Field data panel** sends the result to the Environmental panel (section 5).

| Source switch | Needs | Notes |
|---|---|---|
| **Cached (offline)** (default) | nothing | Reads `data/satellite/cache_manifest.js`; works by double-click |
| **Live (Python backend)** | `satellite_server.py` + internet | Any date; also custom lat/lon; result is added to the cache |

### Included cached analyses (real imagery)

| Location | Scene dates | Sand in 200 m road strip | Sand, whole area | Nearest sand to centreline |
|---|---|---|---|---|
| Divided highway across the Ad-Dahna sand belt (25.14° N, 48.27° E) | 2026-10-23, 2026-04-18 | 77.6 %, 81.1 % | 96.7 %, 97.5 % | 0 m |
| Highway north-west of Salwa (24.89° N, 50.67° E) | 2026-10-20, 2026-01-18 | 47.9 %, 52.6 % | 54.4 %, 55.4 % | 10 m |
| Highway south of the Salwa interchange (24.80° N, 50.72° E) | 2026-10-20, 2026-10-05 | 64.6 %, 69.6 % | 59.4 %, 55.3 % | 0 m |

Values come from `result.json` in each cache folder (rule-based estimates, see below).

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
| Road geometry | Optional | Shipped: hand-traced centrelines for the 3 locations. Better: `python3 python/satellite_cache.py --refresh-roads` (OpenStreetMap via Overpass, needs internet), or put your own `data/satellite/roads/<id>.geojson` (LineString, WGS84). Live custom points try OpenStreetMap automatically. |
| Proxy / company network | Only if HTTPS fails | Set `REQUESTS_CA_BUNDLE` (and `CURL_CA_BUNDLE` for GDAL) to your CA file. |
| `js/config.js` | Optional | `SATELLITE_API_BASE`, `SATELLITE_DEFAULT_SOURCE` (`"cache"`/`"live"`), `SATELLITE_REQUEST_TIMEOUT_MS`. |

The server shows which provider it uses at start-up and in `GET /api/satellite/status`.
Force one with `?provider=cdse|aws` or `satellite_cache.py --provider cdse`.

### Offline cache
```bash
python3 python/satellite_cache.py                        # every location at its default date
python3 python/satellite_cache.py --location dahna_highway --date 2026-07-15
python3 python/satellite_cache.py --lat 24.90 --lon 50.65 --date 2026-10-20
python3 python/satellite_cache.py --list                 # what is cached
python3 python/satellite_cache.py --manifest-only        # rebuild cache_manifest.js
```
Each run writes `data/satellite/cache/<location>/<scene date>/` and regenerates
`cache_manifest.js`. Run it before a demo (or analyse live once); the images then show without
internet. New locations: add an entry to `data/satellite/locations.json`.

### API (`satellite_server.py`)
| Request | Returns |
|---|---|
| `GET /api/satellite/status` | provider, whether CDSE is configured, number of cached analyses |
| `GET /api/satellite/locations` | `locations.json` |
| `GET /api/satellite/analysis?location=<id>&date=YYYY-MM-DD` | runs a live analysis (saved to cache) |
| `…&mode=cache` | the cached result for that scene date, or 404 |
| `GET /api/satellite/analysis?lat=..&lon=..&date=..` | custom point (road from OpenStreetMap if reachable) |

Errors come back as `{"error", "hint"}` (422 no usable scene, 502 network, 404 unknown).

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
| `sand_coverage_pct` | Sand share of valid pixels within `buffer_m` (200 m) of the road centreline |
| `vegetation_coverage_pct`, `bare_soil_pct` | Same strip; bare soil = other bare ground (gravel, rock, sabkha, paved) |
| `distance_to_road_m` | Distance from the road **centreline** to the nearest detected sand pixel, in 10 m steps. `0` = sand in the centreline pixel; on a divided highway this includes a sandy median. |
| `area_*_pct` | The same shares for the whole 5 × 5 km area |
| `valid_pct`, `cloud_pct` | Share of the area that was usable / cloudy |

Without valid road geometry (none available, or it does not cross the area) the strip values and
distance are `null` with `distance_to_road_m_reason`; the Field data panel then uses the
whole-area shares and says so.

### Honesty rules built in
- Every number comes from Sentinel-2 pixels; nothing is filled in or simulated. Unknown = `null` → "—".
- Satellite results are labelled "Real Sentinel-2 … not measured by the physical prototype",
  carry the scene ID and date, and never appear as `sand_01` / `wind_01`, in the risk pills or
  in the experiment log. The Low / Medium / High simulation and Live Sensor Mode are unchanged.
- Contains modified Copernicus Sentinel data (attribution saved in each result).

### Limitations
- Rule-based detection, not validated against field surveys. Pale sand, sabkha and caprock with
  sand-like colour can be confused; mixed 10 m pixels blur edges. Treat values as estimates.
- The shipped road centrelines were traced by hand on the images (± 10–20 m) and cover the main
  carriageway only. Replace them with OpenStreetMap (`--refresh-roads`) when online.
- Distance is measured to the centreline, not the paved edge (road width is not known).
- 10 m pixels cannot see a thin sand film on asphalt; the result describes sand around the road.
- The scene is the nearest clear one to the chosen date (the date used is always shown).
- No weather data is attached to satellite results.
