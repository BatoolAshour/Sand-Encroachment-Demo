SAND ENCROACHMENT PROTOTYPE — SHARED MOCK DATA v1.0

For PRO-01 (HTML Dashboard) and PRO-06 (Python Backend).

Canonical file: shared_mock_data.json
Both team members should use the SAME unchanged file. Scenario IDs: low, medium, high.

Each reading has exactly these six contract fields:
  timestamp: ISO 8601 UTC string
  sensor_id: wind_01 or sand_01 (provisional)
  value: number
  unit: m/s for wind, cm for sand
  source: scenario (NOT live)
  status: ok

Scenario metadata: scenario_id, label, risk_level.
Risk levels are preset display labels, NOT outputs of a trained model.
Values are illustrative and fixed, NOT real sensor readings or scientifically validated thresholds.

PRO-01: load the JSON and render a selected scenario. Label it Scenario / Demo.
PRO-06: load the same JSON in Python; return the selected scenario via API. Do not use the existing random get_mock_reading() for the shared scenario display.

Existing /api/readings currently generates random mock wind data. It is not yet linked to this file. Coordinate a new endpoint, e.g. GET /api/scenarios/<scenario_id>, before integrating.

Do not silently change units, IDs, fields, or values. Agree on a v2.0 file if sensors, dimensions, or requirements change.
