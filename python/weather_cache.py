"""
weather_cache.py — download REAL historical weather (Open-Meteo) for the
research routes, so the dashboard can show it offline.

    python weather_cache.py                       # every cached satellite image (segment + scene date)
    python weather_cache.py --date 2026-10-20     # those segments, another date
    python weather_cache.py --route route4_abqaiq_salasil --date 2026-10-18          # all segments of a route
    python weather_cache.py --route route3_al_ahsa_salwa --segments 1,16 --date 2026-10-20
    python weather_cache.py --list                # what is in the cache

Writes data/weather/weather_cache.js (const WEATHER_CACHE = {...}), loaded by
index.html. Existing entries are kept unless --force is given.

Same requests and record format as js/weather.js:
  - point: the segment centre from data/satellite/routes.json (KMZ import)
  - dates at least 6 days old: archive-api (ERA5 / ERA5-Land reanalysis);
    newer past dates, or when the archive has no values yet: the forecast
    API's own analysis for that past date (up to 92 days back)
  - today and future dates are refused: today's conditions are fetched live
    in the browser, and forecasts are out of scope
  - the raw Open-Meteo answer is stored unchanged

Needs internet access to archive-api.open-meteo.com and api.open-meteo.com
(no API key). Standard library only.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
ROUTES_FILE = REPO_ROOT / "data" / "satellite" / "routes.json"
SAT_CACHE_DIR = REPO_ROOT / "data" / "satellite" / "cache"
WEATHER_JS = REPO_ROOT / "data" / "weather" / "weather_cache.js"

# Keep in step with js/config.js and js/weather.js.
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
TIMEZONE = "Asia/Riyadh"
TZ_OFFSET = dt.timedelta(hours=3)
ARCHIVE_MIN_AGE_DAYS = 6
FORECAST_PAST_DAYS = 92
TIMEOUT_S = 30
HOURLY = ["temperature_2m", "relative_humidity_2m", "precipitation",
          "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m"]
DAILY = ["temperature_2m_max", "temperature_2m_min", "precipitation_sum",
         "wind_speed_10m_max", "wind_gusts_10m_max", "wind_direction_10m_dominant"]


class WeatherError(Exception):
    pass


def today():
    return (dt.datetime.now(dt.timezone.utc) + TZ_OFFSET).date()


def request_url(lat, lon, date, api):
    q = urllib.parse.urlencode({
        "latitude": f"{lat:.5f}", "longitude": f"{lon:.5f}",
        "start_date": date, "end_date": date,
        "hourly": ",".join(HOURLY), "daily": ",".join(DAILY),
        "timezone": TIMEZONE, "wind_speed_unit": "ms",
    })
    return f"{ARCHIVE_URL if api == 'archive' else FORECAST_URL}?{q}"


def fetch_json(url):
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT_S) as res:
            body = json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        try:
            reason = json.loads(err.read().decode("utf-8")).get("reason")
        except (ValueError, OSError):
            reason = None
        raise WeatherError(f"Open-Meteo error {err.code}: {reason or err.reason}") from err
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        raise WeatherError(f"Open-Meteo is not reachable: {getattr(err, 'reason', err)}") from err
    if not isinstance(body, dict) or body.get("error"):
        raise WeatherError(f"Open-Meteo error: {(body or {}).get('reason', 'unexpected answer')}")
    return body


def has_values(r):
    return any(v is not None for v in ((r.get("hourly") or {}).get("wind_speed_10m") or []))


def check_response(r, lat, lon):
    hourly = r.get("hourly") or {}
    if not hourly.get("time"):
        raise WeatherError("no hourly data for this date")
    unit = (r.get("hourly_units") or {}).get("wind_speed_10m")
    if unit and unit != "m/s":
        raise WeatherError(f"unexpected wind unit {unit}")
    if abs(r["latitude"] - lat) > 0.5 or abs(r["longitude"] - lon) > 0.5:
        raise WeatherError("answer is for a different place")
    if not has_values(r):
        raise WeatherError("no weather data for this date at this point yet")


def fetch_record(route_id, segment, date):
    """One cache record (same fields as js/weather.js)."""
    age = (today() - dt.date.fromisoformat(date)).days
    if age <= 0:
        raise WeatherError("only past dates are cached (today is fetched live; forecasts are out of scope)")
    lon, lat = segment["center"]
    api = "archive" if age >= ARCHIVE_MIN_AGE_DAYS else "forecast"
    url = request_url(lat, lon, date, api)
    response = fetch_json(url)
    if api == "archive" and not has_values(response) and age <= FORECAST_PAST_DAYS:
        api = "forecast"
        url = request_url(lat, lon, date, api)
        response = fetch_json(url)
    check_response(response, lat, lon)
    return {
        "v": 1, "key": f"{segment['id']}|{date}", "kind": "historical", "api": api, "url": url,
        "route_id": route_id, "segment_id": segment["id"], "lat": lat, "lon": lon, "date": date,
        "fetched_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "response": response,
    }


# ---------- Cache file ----------
def read_cache(path=WEATHER_JS):
    if not path.exists():
        return {}
    text = path.read_text(encoding="utf-8")
    start = text.index("{", text.index("WEATHER_CACHE"))
    return json.loads(text[start:text.rindex("}") + 1]).get("entries", {})


def write_cache(entries, path=WEATHER_JS):
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Open-Meteo (archive-api: ERA5 / ERA5-Land reanalysis; api: weather-model analysis)",
        "entries": dict(sorted(entries.items())),
    }
    path.write_text(
        "/* GENERATED by python/weather_cache.py. Do not edit by hand.\n"
        " * Real historical weather from Open-Meteo at the research-route segment centres,\n"
        " * raw API answers kept unchanged. Real-world weather, NOT prototype sensor readings. */\n"
        "const WEATHER_CACHE = " + json.dumps(data, indent=1, ensure_ascii=False) + ";\n",
        encoding="utf-8")


# ---------- What to fetch ----------
def load_routes():
    return json.loads(ROUTES_FILE.read_text(encoding="utf-8"))["routes"]


def satellite_targets():
    """(segment id, scene date) of every cached Sentinel-2 analysis."""
    out = []
    for path in sorted(SAT_CACHE_DIR.glob("*/*/result.json")):
        try:
            r = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if r.get("segment"):
            out.append((r["segment"]["id"], r["scene"]["date"]))
    return out


def targets(routes, route_id=None, segments=None, date=None):
    by_id = {s["id"]: (r["id"], s) for r in routes for s in r["segments"]}
    if route_id:
        route = next((r for r in routes if r["id"] == route_id), None)
        if not route:
            raise WeatherError(f"unknown route {route_id} (choose from {', '.join(r['id'] for r in routes)})")
        segs = route["segments"]
        if segments:
            segs = [s for s in segs if s["index"] in segments]
            missing = set(segments) - {s["index"] for s in segs}
            if missing:
                raise WeatherError(f"{route_id} has no segment {', '.join(map(str, sorted(missing)))}")
        when = date or route["default_date"]
        return [(route["id"], s, when) for s in segs]
    pairs = satellite_targets()
    if date:
        pairs = sorted({(seg, date) for seg, _ in pairs})
    return [(*by_id[seg], d) for seg, d in pairs if seg in by_id]


def main(argv=None):
    p = argparse.ArgumentParser(description="Cache real Open-Meteo weather for the research routes")
    p.add_argument("--route", help="route id (default: the segments of the cached satellite images)")
    p.add_argument("--segments", help="segment numbers of --route, e.g. 1,16,30 (default: all)")
    p.add_argument("--date", help="YYYY-MM-DD (default: each satellite scene date, or the route's default date)")
    p.add_argument("--force", action="store_true", help="download again even if cached")
    p.add_argument("--list", action="store_true", help="show the cache and exit")
    a = p.parse_args(argv)

    entries = read_cache()
    if a.list:
        for key, rec in sorted(entries.items()):
            print(f"{key:<36} {rec['api']:<8} fetched {rec['fetched_at']}")
        print(f"{len(entries)} entries in {WEATHER_JS.relative_to(REPO_ROOT)}")
        return 0
    if a.segments and not a.route:
        p.error("--segments needs --route")

    try:
        segs = [int(x) for x in a.segments.split(",")] if a.segments else None
        if a.date:
            dt.date.fromisoformat(a.date)
        todo = targets(load_routes(), a.route, segs, a.date)
    except (WeatherError, ValueError) as err:
        p.error(str(err))

    failed = 0
    for route_id, seg, date in todo:
        key = f"{seg['id']}|{date}"
        if key in entries and not a.force:
            print(f"cached  {key}")
            continue
        try:
            entries[key] = fetch_record(route_id, seg, date)
            print(f"OK      {key}  ({entries[key]['api']})")
        except WeatherError as err:
            failed += 1
            print(f"FAILED  {key}: {err}")
        write_cache(entries)     # keep what worked so far
    print(f"{len(entries)} entries in {WEATHER_JS.relative_to(REPO_ROOT)}, {failed} failed.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
