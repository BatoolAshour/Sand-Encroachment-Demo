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
cd pro-01-dashboard
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
│   ├── dataSources.js         SimulationSource (browser) and LiveSensorSource (Python)
│   ├── logger.js              Experiment log + CSV export
│   ├── dashboard.js           Drawing: updateDashboard(sensorData) and helpers
│   └── app.js                 State + button logic; connects everything
├── python/
│   ├── bridge.py              Future Arduino → WebSocket bridge (template)
│   └── requirements.txt       pyserial, websockets
└── data/
    ├── sample_reading.json          Full data object used by the dashboard
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
- CSV columns: `run_id, timestamp, elapsed_s, mode, scenario, sand_level, risk_level, road_condition, status`.
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

## 9. Known limitations

- `bridge.py` has **not** been tested with a real Arduino/ESP32; baud rate and the
  sensor-to-percentage conversion still need to be agreed with the hardware part (PRO-06).
- The simulation is a simple visual model (rate + randomness), not a physical sand-transport model.
- Sensor markers S1–S3 on the road picture are illustrative positions.
- The browser log is cleared when the page is refreshed.
- No AI map or prediction model is included (out of scope for PRO-01).
