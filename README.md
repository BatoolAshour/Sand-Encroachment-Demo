# Sand Encroachment Monitoring System — PRO-01 Dashboard

A browser dashboard for monitoring sand encroachment on roads. It drives a physical prototype
(a road in a sand box with a wind fan and sensors) and shows real satellite and weather data for
three research roads in Saudi Arabia.

## Team

1. Farah Almujaljel
2. Lina Alqahtani
3. Aryam Bargash
4. Alaa Bughararah
5. Batool Ashour
6. Raneem Bahobail

**Major:** Artificial Intelligence  
**University:** Imam Abdulrahman bin Faisal University

## Current objective

Build a working **detection and monitoring** system for sand on roads:
1. **Prototype:** show Low / Medium / High sand scenarios and live Arduino readings (`sand_01` sand
   depth, `wind_01` wind speed) on an animated road, with a log and CSV export.
2. **Satellite:** detect sand along the research routes in Sentinel-2 images.
3. **Weather:** show the wind and weather conditions at the same road segments.

Prediction (machine learning, forecasting sand movement) is the **next phase** and is not part of
this dashboard.

## Data sources

| Data | Source | Shown as |
|---|---|---|
| Scenario readings | `data/shared_mock_data.json` v1.0, the team's shared file (used unchanged) | Simulated (amber) |
| Live readings | Arduino sensors `sand_01`, `wind_01` → `python/bridge.py` → WebSocket | Live sensor (green) |
| Research routes | KMZ files for Route 3 Al-Ahsa – Salwa, Route 4 Abqaiq – Salasil, Route 5 Al-Ahsa – Riyadh (centreline + 2 km study area, coordinates unchanged) | — |
| Satellite images | Sentinel-2 Level-2A from Copernicus Data Space or the AWS Open Data archive | Satellite-derived (blue) |
| Weather | Open-Meteo: ERA5 / ERA5-Land reanalysis for past dates, weather-model analysis for recent days and today | Weather model (violet) |
| Field data sample | Hand-written example values in `js/environmentData.js` | Sample data (amber) |

Satellite and weather data describe real roads, not the prototype box. They are never shown as
sensor readings and never feed the fan, the risk label or the experiment log.

---

## How to run

```bash
cd Sand-Encroachment-Demo
python3 -m http.server 8000          # then open http://localhost:8000
```
Or double-click `index.html`; it works offline either way (scenarios, cached satellite images
and cached weather). Hard-reload (**Cmd+Shift+R**) after updating files.

Optional extras:
```bash
pip install -r python/requirements.txt
python3 python/bridge.py --list-ports && python3 python/bridge.py --port <port>   # live Arduino
python3 python/satellite_server.py                                                # live satellite analysis (:8780)
python3 python/weather_cache.py                                                   # cache weather for offline demos
```

## Dashboard views

| View | What it does |
|---|---|
| **Overview** | Status of the simulation, Arduino bridge, satellite cache, weather, log and system checks. |
| **Road Simulation** | Animated road, Scenario / Live switch, Low / Medium / High, Start / Stop / Reset, readings, preset risk label. |
| **Satellite Monitoring** | Route → segment → date, cached or live; original and processed image side by side; sand measurements. |
| **Weather Monitoring** | Wind speed, gusts, direction (compass), temperature, humidity, rain, and a wind-through-the-day chart. |
| **Experiment Logs** | Every reading with run summaries, filters and CSV export. |

Each view has its own address (e.g. `index.html#weather`); on phones the sidebar is a ☰ menu.

## Folder structure

```
├── index.html, css/styles.css
├── js/        config, app (state + buttons), dataSources, dashboard, views (navigation),
│              satellite, weather, logger, risk, environmentData / environmentRule
├── python/    bridge.py, satellite_server.py, satellite_cache.py, weather_cache.py,
│              import_routes.py, sync_shared_data.py, satellite/ (pipeline), tests/
└── data/      shared_mock_data.json, satellite/ (routes, KMZ, cache), weather/weather_cache.js
```
Settings are in `js/config.js`. Search the code for `INTEGRATION POINT` to find where the
PRO-06 backend, satellite and weather plug in.

---

## Prototype: scenarios and live sensors

| Scenario | wind_01 | sand_01 | Preset risk |
|---|---|---|---|
| Low | 2.0 m/s | 0.5 cm | low |
| Medium | 6.0 m/s | 2.5 cm | medium |
| High | 11.0 m/s | 5.0 cm | high |

- Values come exactly from the shared file, which is validated on load (six contract fields:
  `timestamp, sensor_id, value, unit, source, status`). Nothing is random.
- **Live mode:** the Arduino prints `sand_01,2.4` or `{"sensor_id": "wind_01", "value": 6.1}`
  per line; Start / Stop / Reset are forwarded to it. Connection loss, missing readings and
  reconnects are shown on the page. Live readings are **not classified** because no cm thresholds
  are agreed yet.
- **Log / CSV:** one row per reading while running (run, time, mode, scenario, the six contract
  fields). The log is cleared when the page is refreshed, so export first.
- The **demo risk indicator** under the road is an illustrative weighted rule (wind, sand cover,
  distance, vegetation) for the sample field data only. It is not validated and not a prediction.

After the team updates the shared file: `python3 python/sync_shared_data.py` (and `--check`).

## Satellite monitoring (Sentinel-2)

- Each route is cut into ~5 km segments (31 / 9 / 66 segments). One analysis = one segment on
  the nearest clear date, measured inside that segment's part of the 2 km study area.
- **Detection:** cloud / water / shadow removed with the Scene Classification Layer, then sand
  found by colour (HSV + Otsu threshold), Bare Soil Index, NDVI and texture, and cleaned with
  morphology. Parameters are in `python/satellite/processing.py`.
- **Results:** sand % of the study area, sand % within a road buffer (default 200 m), distance
  from the centreline to the nearest sand.
- **12 analyses are cached** and work offline. Add more with
  `python3 python/satellite_cache.py --route 4 --segments 3 --date 2026-10-20`, or use Live.
- Credentials are optional: set `CDSE_CLIENT_ID` / `CDSE_CLIENT_SECRET` for Copernicus Data
  Space; without them the public AWS archive is used.

## Weather (Open-Meteo)

- Pick route, segment, date and hour, or **Match satellite image** to use the scene's date and
  time. The point is the segment centre from the KMZ.
- Past dates (6+ days) use ERA5 / ERA5-Land, recent days the models' analysis, today the current
  values. Future dates are refused (no forecasts).
- Results are cached in the browser and in `data/weather/weather_cache.js` for offline demos.
- Values describe a 9–25 km model grid cell, not a measurement at the road.

---

## Testing

```bash
cd python && python3 -m unittest discover -s tests     # 24 offline tests
```
Browser tests (Chromium) cover every view and control: scenarios, Start / Stop / Reset, CSV
export, cached and live satellite analysis, weather loading, Live mode with and without the
bridge (virtual serial port), the phone menu, no horizontal scrolling and no JavaScript errors.

## Known limitations

- Scenario values are illustrative; a run repeats the same readings.
- `bridge.py` is tested with a virtual serial port, not yet with a real Arduino.
- Live readings are not classified (no agreed thresholds); the PRO-06 scenario API is not agreed yet.
- Satellite sand detection is rule-based and not validated against field surveys; only 12 of
  106 segments are cached.
- Weather is model data for a grid cell; not checked against weather stations.
- No machine learning or prediction (next phase).

Contains modified Copernicus Sentinel data. Weather data by Open-Meteo.com (CC BY 4.0), ERA5 /
ERA5-Land from the Copernicus Climate Change Service.
