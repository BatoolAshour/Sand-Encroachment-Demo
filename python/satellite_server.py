"""
satellite_server.py — Python backend for the Satellite Monitoring section.

Separate from bridge.py: the Arduino / sensor contract is not touched here.
Satellite results are real Sentinel-2 observations, NOT prototype readings.

    pip install -r requirements.txt
    python satellite_server.py                 # http://localhost:8780
    (optional) export CDSE_CLIENT_ID=… CDSE_CLIENT_SECRET=…   # Copernicus Data Space

Then open http://localhost:8780/ (the dashboard is served too), or keep
opening index.html by double-click: it talks to CONFIG.SATELLITE_API_BASE.

Endpoints:
    GET /api/satellite/status
    GET /api/satellite/locations
    GET /api/satellite/analysis?location=<id>&date=YYYY-MM-DD[&mode=live|cache][&provider=auto|cdse|aws]
    GET /api/satellite/analysis?lat=<deg>&lon=<deg>&date=YYYY-MM-DD           (custom point, live)
Each analysis is saved in data/satellite/cache/ and added to
data/satellite/cache_manifest.js, so it also works offline afterwards.
"""

import argparse
import sys

try:
    import requests
    from flask import Flask, jsonify, request, send_from_directory
except ImportError:
    sys.exit("Missing packages. Run:  pip install -r python/requirements.txt")

from satellite.analysis import REPO_ROOT, analyse, custom_location, find_location, load_locations
from satellite.cache import cached_results, find_cached, write_manifest
from satellite.providers import CdseProvider, SatelliteError, get_provider

app = Flask(__name__)


@app.after_request
def headers(resp):
    # index.html may be opened from file:// (origin "null"); the API is local and read-only.
    resp.headers["Access-Control-Allow-Origin"] = "*"
    # Always revalidate, so the browser never mixes old cached scripts with a new page.
    resp.headers["Cache-Control"] = "no-cache"
    return resp


def error(status, message, hint=None):
    return jsonify({"error": message, "hint": hint}), status


@app.get("/api/satellite/status")
def status():
    return jsonify({
        "ok": True,
        "provider": get_provider("auto").name,
        "cdse_configured": CdseProvider.from_env() is not None,
        "cached_analyses": len(cached_results()),
    })


@app.get("/api/satellite/locations")
def locations():
    return jsonify({"locations": load_locations()})


@app.get("/api/satellite/analysis")
def analysis():
    date = request.args.get("date", "")
    mode = request.args.get("mode", "live")
    provider = request.args.get("provider", "auto")
    lat, lon = request.args.get("lat"), request.args.get("lon")

    if lat is not None and lon is not None:
        try:
            location = custom_location(float(lat), float(lon))
        except ValueError:
            return error(400, "lat and lon must be numbers.")
    else:
        location = find_location(request.args.get("location", ""))
        if not location:
            return error(404, "Unknown location.")
    if mode not in ("live", "cache") or provider not in ("auto", "cdse", "aws"):
        return error(400, "mode must be live|cache and provider auto|cdse|aws.")
    if not date:
        date = location.get("default_date", "")

    if mode == "cache":
        cached = find_cached(location["id"], date or None)
        return jsonify(cached) if cached else error(404, "Not in the local cache.",
                                                    "Run a live analysis once, or python satellite_cache.py.")
    try:
        result = analyse(location, date, provider=provider, allow_fetch_roads=True)
    except SatelliteError as err:
        return error(422, str(err))
    except requests.RequestException as err:
        return error(502, f"Satellite service not reachable ({err.__class__.__name__}).",
                     "Check the internet connection, or use the cached images.")
    write_manifest()
    return jsonify(result)


@app.get("/")
def index():
    return send_from_directory(REPO_ROOT, "index.html")


@app.get("/<path:path>")
def static_files(path):
    # Only the dashboard's own folders are served.
    if path.split("/", 1)[0] not in ("css", "js", "data"):
        return error(404, "Not found.")
    return send_from_directory(REPO_ROOT, path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Satellite imagery backend for the dashboard")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8780)
    args = parser.parse_args()
    print(f"Satellite provider: {get_provider('auto').name}")
    print(f"Dashboard: http://{args.host}:{args.port}/")
    app.run(host=args.host, port=args.port, threaded=True)
