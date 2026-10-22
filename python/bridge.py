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
       45                       -> plain number, sand level in %
       {"sand_level": 45}       -> JSON
2. Sends each reading to every open dashboard as JSON:
       {"timestamp": "2026-10-22T12:00:00+00:00", "sand_level": 45}
3. Saves every reading to a CSV file.
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


# TODO (PRO-06 / hardware team): confirm baud rate and how the sensor value
# is converted to a 0–100 % sand level inside the Arduino sketch.
BAUD_RATE = 9600
WS_HOST = "localhost"
WS_PORT = 8765

clients = set()


def parse_line(line: str):
    """Turn one serial line into a sand level (0–100), or None if invalid."""
    line = line.strip()
    if not line:
        return None
    try:
        value = json.loads(line)
        if isinstance(value, dict):
            value = value.get("sand_level")
        level = float(value)
    except (ValueError, TypeError):
        return None
    return max(0.0, min(100.0, level))


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
        level = parse_line(raw.decode(errors="ignore"))
        if level is None:
            continue
        reading = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "sand_level": round(level, 1),
        }
        log_writer.writerow([reading["timestamp"], reading["sand_level"]])
        log_file.flush()
        await broadcast(reading)


async def main(port: str):
    ser = serial.Serial(port, BAUD_RATE, timeout=1)
    print(f"Serial port {port} opened at {BAUD_RATE} baud")

    Path("logs").mkdir(exist_ok=True)
    log_path = Path("logs") / f"experiment_{datetime.now():%Y%m%d_%H%M%S}.csv"
    with open(log_path, "w", newline="") as log_file:
        writer = csv.writer(log_file)
        writer.writerow(["timestamp", "sand_level"])
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
