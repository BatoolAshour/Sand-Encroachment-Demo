"""
bridge.py — FUTURE Python backend for Live Sensor Mode (template).

STATUS: prepared for integration, NOT yet tested with real hardware.
The dashboard works without this file (Scenario Simulation runs in the browser).

What it does when the hardware exists:
    Arduino/ESP32 --USB serial--> bridge.py --WebSocket--> dashboard (browser)
                                     |
                                     +--> logs/experiment_<time>.csv

1. Reads one line per reading from the Arduino serial port.
   Accepted line formats (choose one in the Arduino sketch):
       sand_01,2.4                              -> sensor_id,value
       {"sensor_id": "wind_01", "value": 6.1}   -> JSON
2. Sends each reading to every open dashboard in the SAME six-field contract
   as data/shared_mock_data.json (v1.0):
       {"timestamp": "2026-10-22T12:00:00Z", "sensor_id": "sand_01",
        "value": 2.4, "unit": "cm", "source": "live", "status": "ok"}
   NOTE: v1.0 only defines source "scenario". "live" is a PROPOSAL for real
   sensors and must be agreed with PRO-06 (v2.0) before use.
3. Saves every reading to a CSV file (same six columns).
4. Forwards dashboard commands (start / stop / reset) to the Arduino as
   text lines "START", "STOP", "RESET" (e.g. to switch the fan on/off).

It never makes up readings: without a serial port it refuses to start.

Setup:
    pip install -r requirements.txt
    python bridge.py --port COM3              (Windows)
    python bridge.py --port /dev/ttyUSB0      (Linux / macOS: /dev/cu.usbserial-…)
Then in js/config.js set:  LIVE_BACKEND_URL: "ws://localhost:8765"
"""

import argparse
import asyncio
import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    import serial          # pyserial
    import websockets
except ImportError:
    sys.exit("Missing packages. Run:  pip install -r requirements.txt")


# TODO (PRO-06 / hardware team): confirm baud rate and the sensor calibration
# (sand_01 depth in cm, wind_01 speed in m/s) inside the Arduino sketch.
# PRO-06 owns the real backend; this file is a reference template only.
BAUD_RATE = 9600
WS_HOST = "localhost"
WS_PORT = 8765

clients = set()


# Provisional sensor IDs and units from the shared data contract v1.0.
UNITS = {"wind_01": "m/s", "sand_01": "cm"}
CONTRACT_FIELDS = ["timestamp", "sensor_id", "value", "unit", "source", "status"]


def parse_line(line: str):
    """Turn one serial line into (sensor_id, value), or None if invalid."""
    line = line.strip()
    if not line:
        return None
    try:
        if line.startswith("{"):
            data = json.loads(line)
            sensor_id, value = data.get("sensor_id"), float(data.get("value"))
        else:
            sensor_id, value = line.split(",", 1)
            sensor_id, value = sensor_id.strip(), float(value)
    except (ValueError, TypeError, AttributeError):
        return None
    if sensor_id not in UNITS:
        return None
    return sensor_id, value


async def broadcast(message: dict):
    data = json.dumps(message)
    for ws in list(clients):
        try:
            await ws.send(data)
        except websockets.ConnectionClosed:
            clients.discard(ws)


async def handle_client(ws, ser):
    """One dashboard tab connected. Listen for its commands."""
    clients.add(ws)
    print(f"Dashboard connected ({len(clients)} open)")
    try:
        async for text in ws:
            try:
                command = json.loads(text).get("command")
            except (ValueError, AttributeError):
                continue
            if command in ("start", "stop", "reset"):
                ser.write(f"{command.upper()}\n".encode())
                print(f"Command sent to Arduino: {command.upper()}")
    finally:
        clients.discard(ws)
        print(f"Dashboard disconnected ({len(clients)} open)")


async def read_serial_forever(ser, log_writer, log_file):
    loop = asyncio.get_running_loop()
    while True:
        # readline() blocks, so run it in a worker thread.
        raw = await loop.run_in_executor(None, ser.readline)
        parsed = parse_line(raw.decode(errors="ignore"))
        if parsed is None:
            continue
        sensor_id, value = parsed
        reading = {
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "sensor_id": sensor_id,
            "value": value,
            "unit": UNITS[sensor_id],
            "source": "live",   # proposal, not in v1.0 (see note at top)
            "status": "ok",
        }
        log_writer.writerow([reading[f] for f in CONTRACT_FIELDS])
        log_file.flush()
        await broadcast(reading)


async def main(port: str):
    ser = serial.Serial(port, BAUD_RATE, timeout=1)
    print(f"Serial port {port} opened at {BAUD_RATE} baud")

    Path("logs").mkdir(exist_ok=True)
    log_path = Path("logs") / f"experiment_{datetime.now():%Y%m%d_%H%M%S}.csv"
    with open(log_path, "w", newline="") as log_file:
        writer = csv.writer(log_file)
        writer.writerow(CONTRACT_FIELDS)
        print(f"Logging to {log_path}")

        async with websockets.serve(lambda ws: handle_client(ws, ser), WS_HOST, WS_PORT):
            print(f"WebSocket ready at ws://{WS_HOST}:{WS_PORT}")
            await read_serial_forever(ser, writer, log_file)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Arduino -> dashboard bridge")
    parser.add_argument("--port", required=True, help="Arduino serial port, e.g. COM3 or /dev/ttyUSB0")
    args = parser.parse_args()
    try:
        asyncio.run(main(args.port))
    except serial.SerialException as err:
        sys.exit(f"Could not open serial port: {err}")
    except KeyboardInterrupt:
        print("Stopped.")
