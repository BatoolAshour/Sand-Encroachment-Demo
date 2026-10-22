# Sand Encroachment Monitoring System — PRO-01 Digital Demo & Dashboard

A browser-based simulation of the physical prototype (a road inside a box with sand,
sensors and a wind mechanism). It shows how sand encroachment builds up on the road
and how the risk level changes, **before** the hardware is tested.

> Prototype demonstration only. The risk thresholds are example values, not a
> scientifically validated road-safety prediction.

---

## 1. How to run it

No installation, no internet, no backend needed.

**Option A (simplest):** double-click `index.html`. It opens in any modern browser
(Chrome, Edge, Firefox, Safari).

**Option B (local server, recommended once the Python backend exists):**
```bash
cd Sand-Encroachment-Demo
python -m http.server 8000
```
Then open <http://localhost:8000>.

---

## 2. Folder structure

```
pro-01-dashboard/
├── index.html                 Page layout (all dashboard sections)
├── css/
│   └── styles.css             Colours, layout, responsive rules
├── js/
│   ├── config.js              ALL settings: risk thresholds, scenarios, backend URL
│   ├── risk.js                Sand level → risk level + road condition
│   ├── environmentData.js     SAMPLE satellite + weather records, schema, provider
│   ├── environmentRule.js     Demo multi-variable indicator + explanation
│   ├── dataSources.js         SimulationSource (browser) and LiveSensorSource (Python)
│   ├── logger.js              Experiment log + CSV export
│   ├── dashboard.js           Drawing: updateDashboard(sensorData) and helpers
│   └── app.js                 State + button logic; connects everything
├── python/
│   ├── bridge.py              Future Arduino → WebSocket bridge (template)
│   └── requirements.txt       pyserial, websockets
└── data/
    ├── sample_reading.json          Full data object used by the dashboard
    ├── sample_environment_scenarios.json  The 3 sample environment records (same as the JS)
    └── sample_backend_message.json  Minimal message the Python backend sends
```

### How the files work together

```
 [Start/Stop/Reset, mode, scenario]          app.js  (state + controls)
                 │                               │
                 ▼                               ▼
       dataSources.js  ── raw reading ──►  handleReading()
   (Simulation or Live)   {timestamp,            │
                           sand_level}           ├─► risk.js     classify risk + road condition
                                                 ├─► logger.js   add a log row
                                                 └─► dashboard.js updateDashboard(sensorData)
```

1. **app.js** keeps the state (`mode`, `status`, `scenario`, `runId`, last reading) and listens to the buttons.
2. The active **data source** produces raw readings `{ timestamp, sand_level }`.
3. **app.js** builds one complete data object (adds risk, road condition, mode, status…).
4. That object is saved by **logger.js** and drawn by **`updateDashboard(sensorData)`** in dashboard.js.

Because everything goes through `updateDashboard(sensorData)`, simulated data and real sensor
data are displayed by exactly the same code.

---

## 3. The data object

```json
{
  "timestamp": "2026-10-22T12:00:00.000Z",
  "sand_level": 45,
  "risk_level": "Medium",
  "road_condition": "Partially covered",
  "mode": "simulation",
  "status": "running",
  "scenario": "medium",
  "elapsed_s": 38
}
```

| Field | Values |
|---|---|
| `sand_level` | 0–100 (%), or `null` in Live mode when no reading exists |
| `risk_level` | `"Low"`, `"Medium"`, `"High"` (or `null`) |
| `mode` | `"simulation"` or `"live"` |
| `status` | `"running"`, `"stopped"`, `"reset"` |
| `scenario` | `"low"`, `"medium"`, `"high"` (simulation only, else `null`) |

You can see the live object on the page under **Live data → Current data object (JSON)**.

---

## 3b. Sample satellite & weather data

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
| Road simulation | 0.6 %/s, stops at 28 % | 1.2 %/s, stops at 58 % | 2.0 %/s, up to 100 % |

Selecting a scenario updates everything together: the weather cards, the satellite bars and
distance, the strip above the road in the picture (sand front position, number of shrubs,
wind arrow speed), the demo indicator and its explanation, and the road simulation speed.
The scenario can be changed while running; new log rows then carry the new values.

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

The score is classified with the same `RISK_BANDS` (0–30 Low, 31–60 Medium, 61–100 High).
The dashboard shows each factor's points and a one-line reason.

**Important:**
- This rule only shows how several variables *could* feed a risk assessment. It is not
  validated and it is **not** the future AI prediction model, which will be trained on real data.
- Temperature and humidity are **not** used, and neither one alone decides road risk.
- The main **Road risk level** (top right) is unchanged. It still comes from the simulated
  sand on the road, so at the start of a run it shows Low even in Scenario 3. The demo
  indicator is a separate, explanatory value.

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

## 4. How the simulation works

- Every second (`TICK_INTERVAL_MS`) the simulation adds sand:
  `new level = old level + rate × random(0.6 … 1.4)`.
- Each scenario has a `rate` and a `maxLevel` (in `config.js`):

| Scenario | Rate per second | Stops at | Ends in |
|---|---|---|---|
| Low | 0.6 % | 28 % | Low risk |
| Medium | 1.2 % | 58 % | Medium risk |
| High | 2.0 % | 100 % | High risk (road blocked) |

- Sand never decreases by itself, so the curve only goes up.
- Changing the scenario while running changes the speed immediately; the current level is kept.
- At 100 % the run stops automatically.

### Controls

| Control | What it does |
|---|---|
| **Start** | Starts a run (new run number after Reset). After Stop it shows **Resume** and continues the same run. |
| **Stop** | Pauses. Values stay on screen. |
| **Reset** | Sand level back to 0 %, risk back to Low, status = Reset, timer = 00:00. **The log is kept** so you can still export it. |
| **Scenario** | Low / Medium / High encroachment speed. Disabled in Live mode. |
| **Sensor mode** | Scenario Simulation ↔ Live Sensor. Switching mode resets the current run so simulated and real values are never mixed. |
| **Export CSV** | Downloads every logged reading. |
| **Clear log** | Empties the log. |

---

## 5. How the risk level is calculated

In `js/config.js`:

```js
RISK_BANDS: [
  { level: "Low",    max: 30  },   // 0 – 30 %
  { level: "Medium", max: 60  },   // 31 – 60 %
  { level: "High",   max: 100 },   // 61 – 100 %
],
```

`classifyRisk()` in `risk.js` rounds the sand level to a whole number and returns the first
band whose `max` is not exceeded (30.4 % → 30 → Low; 30.5 % → 31 → Medium).

To change the thresholds, edit the `max` values only. The gauge marks and the legend update
automatically. Road condition labels work the same way (`ROAD_CONDITIONS`).

The risk is always calculated in the browser, including for real sensor data, so one set of
thresholds applies everywhere.

---

## 6. Experiment log & CSV

- A row is added for each reading while the status is **running**.
- CSV columns: `run_id, timestamp, elapsed_s, mode, scenario, sand_level, risk_level, road_condition, status`,
  then the environment columns `data_source, observation_date, temperature_c, humidity_pct, wind_speed_mps,
  sand_coverage_pct, vegetation_coverage_pct, bare_soil_pct, distance_to_road_m, demo_indicator_score,
  demo_indicator_level`. While `data_source` is `sample`, those values are sample data.
- The log lives in browser memory: refreshing the page clears it. Export before closing.

---

## 7. Live Sensor Mode and the future Python backend

**Current state:** not connected. `LIVE_BACKEND_URL` is `null`, so Live mode shows
"Hardware not connected / Python/Arduino integration is not configured yet" and pressing
Start does nothing. **No readings are ever invented in Live mode.**

### Planned data path

```
Sand sensors → Arduino/ESP32 → USB serial → python/bridge.py → WebSocket → dashboard
                                                   └→ logs/experiment_<time>.csv
```

### Steps to connect (when the hardware is ready)

1. **Arduino sketch**: print one line per reading on serial at 9600 baud, either
   `45` or `{"sand_level": 45}` (sand level already converted to 0–100 %).
   Optionally react to the lines `START`, `STOP`, `RESET` sent back by Python
   (e.g. to switch the fan on/off).
2. **Python**:
   ```bash
   cd python
   pip install -r requirements.txt
   python bridge.py --port COM3          # or /dev/ttyUSB0, /dev/cu.usbserial-xxxx
   ```
3. **Dashboard**: in `js/config.js` set
   ```js
   LIVE_BACKEND_URL: "ws://localhost:8765",
   ```
4. Open the dashboard, choose **Live Sensor**, press **Start**. The header shows
   "Live: Python backend connected" only when the WebSocket is really open.

### Message contract

Backend → dashboard (one JSON per reading):
```json
{ "timestamp": "2026-10-22T12:00:00+00:00", "sand_level": 45 }
```
Dashboard → backend (optional commands):
```json
{ "command": "start" }   { "command": "stop" }   { "command": "reset" }
```
Invalid messages are ignored. If the connection drops, the run stops and the header shows
"Live: not connected".

### Where the integration code is

Search the code for **`[PYTHON / ARDUINO INTEGRATION POINT]`**:
- `js/config.js` → `LIVE_BACKEND_URL`
- `js/dataSources.js` → `LiveSensorSource` class (connection, message parsing, commands)
- `js/app.js` → where the live source is created
- `python/bridge.py` → serial reading, WebSocket server, CSV log (TODO for baud rate / calibration)

---

## 8. What was tested

Tested in Chromium (headless) on 22 Oct 2026:
- Start, Stop (values hold), Resume (same run number), Reset (0 %, Low, Reset, 00:00, log kept).
- Low / Medium / High scenarios and switching scenario while running.
- Risk boundaries: 0, 30 → Low; 30.5, 31, 60 → Medium; 61, 100 → High.
- CSV export (header + one row per reading, correct run numbers), Clear log.
- Live mode without backend: "not configured" message, Start refused, no data shown.
- Live mode with `bridge.py` and a **virtual** serial port (no real Arduino): readings shown,
  invalid serial line ignored, START/STOP forwarded to the serial port, CSV written by Python,
  dashboard stops and shows "not connected" when the backend is closed.
- Phone width (390 px): no horizontal scrolling.
- Sample data: each scenario shows its values (Low 17, Medium 56, High 91), with the same values after
  a page reload; the road strip, shrubs and distance label update; switching scenario mid-run
  changes the logged environment columns; Live mode shows "no environmental data source".

## 9. Known limitations

- `bridge.py` has **not** been tested with a real Arduino/ESP32; baud rate and the
  sensor-to-percentage conversion still need to be agreed with the hardware part (PRO-06).
- The simulation is a simple visual model (rate + randomness), not a physical sand-transport model.
- Sensor markers S1–S3 on the road picture are illustrative positions.
- The browser log is cleared when the page is refreshed.
- No AI map or prediction model is included (out of scope for PRO-01).
- All satellite and weather values are illustrative sample data, not measurements. The demo rule's
  weights and ranges are chosen for explanation, not calibrated.
- The road simulation speed is set per scenario; it is not calculated from the environmental values.
- `data/sample_environment_scenarios.json` is a copy of the JS data (the page cannot read JSON files
  when opened by double-click); keep them in sync if you edit values.
