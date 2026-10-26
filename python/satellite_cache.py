"""
satellite_cache.py — download and analyse real Sentinel-2 images ahead of a demo.

The results are stored in data/satellite/cache/ and listed in
data/satellite/cache_manifest.js, so the dashboard can show them later
WITHOUT internet (also when index.html is opened by double-click).

Examples:
    python satellite_cache.py --list-segments                  # routes and their segments
    python satellite_cache.py --route 3 --segments 1,16,30     # Route 3, three segments, default date
    python satellite_cache.py --route 5 --segments 29 --date 2026-09-15 --buffer-m 500
    python satellite_cache.py --route 4 --all-segments         # every segment of Route 4
    python satellite_cache.py                                  # refresh everything already cached
    python satellite_cache.py --lat 24.90 --lon 50.65 --date 2026-10-20   # custom point (not a route)
    python satellite_cache.py --list                           # show what is cached
    python satellite_cache.py --manifest-only                  # rebuild cache_manifest.js

Routes come from data/satellite/routes.json (python import_routes.py).
Provider: Copernicus Data Space Ecosystem when CDSE_CLIENT_ID and
CDSE_CLIENT_SECRET are set, otherwise the public AWS Sentinel-2 archive.
"""

import argparse
import sys

import requests

from satellite.analysis import (DEFAULT_BUFFER_M, analyse, custom_location, find_segment, load_routes)
from satellite.cache import cached_results, write_manifest
from satellite.providers import SatelliteError
from satellite.routes import RouteError


def summary(r):
    m = r["measurements"]
    dist = f"{m['distance_to_road_m']} m" if m["distance_to_road_m"] is not None else "n/a"
    strip = f"{m['sand_coverage_pct']}% in {m['buffer_m']} m road buffer" if m["sand_coverage_pct"] is not None else "no road buffer"
    return (f"{r['location']['id']:<30} scene {r['scene']['date']} ({r['scene']['id']})  "
            f"sand {m['area_sand_coverage_pct']}% of analysis area, {strip}, nearest sand {dist}, valid {m['valid_pct']}%")


def pick_route(key):
    for r in load_routes():
        if key in (r["id"], str(r["number"])):
            return r
    sys.exit(f"Unknown route '{key}'. Known: " + ", ".join(f"{r['number']} ({r['id']})" for r in load_routes()))


def main():
    p = argparse.ArgumentParser(description="Pre-cache real Sentinel-2 sand analyses for offline demos")
    p.add_argument("--route", help="route number or id from data/satellite/routes.json")
    p.add_argument("--segments", help="comma-separated segment numbers of --route (e.g. 1,16,30)")
    p.add_argument("--all-segments", action="store_true", help="every segment of --route")
    p.add_argument("--lat", type=float)
    p.add_argument("--lon", type=float)
    p.add_argument("--date", help="observation date YYYY-MM-DD (nearest clear scene is used)")
    p.add_argument("--buffer-m", type=int, default=DEFAULT_BUFFER_M,
                   help="road buffer for the extra measurements (m, inside the 2 km study area)")
    p.add_argument("--provider", choices=["auto", "cdse", "aws"], default="auto")
    p.add_argument("--max-days", type=int, default=15, help="search window around the date (days)")
    p.add_argument("--max-cloud", type=float, default=30, help="maximum tile cloud cover (%%)")
    p.add_argument("--fetch-roads", action="store_true", help="custom point: download the road from OpenStreetMap")
    p.add_argument("--list", action="store_true")
    p.add_argument("--list-segments", action="store_true")
    p.add_argument("--manifest-only", action="store_true")
    a = p.parse_args()

    if a.list:
        for r in cached_results():
            print(summary(r))
        return
    if a.list_segments:
        for r in load_routes():
            print(f"{r['name']}  ({r['id']}, {r['length_m'] / 1000:.1f} km)")
            for s in r["segments"]:
                print(f"  {s['index']:3d}  km {s['start_m'] / 1000:6.1f} – {s['end_m'] / 1000:6.1f}   "
                      f"centre {s['center'][1]:.5f}°N {s['center'][0]:.5f}°E   "
                      f"image {s['width_m'] / 1000:.1f} × {s['height_m'] / 1000:.1f} km")
        return
    if a.manifest_only:
        print(f"Manifest written with {len(write_manifest()['analyses'])} analyses.")
        return

    if a.lat is not None or a.lon is not None:
        if a.lat is None or a.lon is None or not a.date:
            sys.exit("--lat, --lon and --date are needed together.")
        jobs = [(custom_location(a.lat, a.lon), a.date)]
    elif a.route:
        route = pick_route(a.route)
        if a.all_segments:
            numbers = [s["index"] for s in route["segments"]]
        elif a.segments:
            numbers = [int(x) for x in a.segments.split(",")]
        else:
            sys.exit("Give --segments 1,2,… or --all-segments (see --list-segments).")
        jobs = []
        for n in numbers:
            if not 1 <= n <= len(route["segments"]):
                sys.exit(f"{route['name']} has segments 1–{len(route['segments'])}.")
            jobs.append((find_segment(route["segments"][n - 1]["id"]), a.date or route["default_date"]))
    else:
        jobs = []
        for r in cached_results():
            loc = find_segment(r["location"]["id"])
            if loc:
                jobs.append((loc, a.date or r["requested_date"]))
        if not jobs:
            sys.exit("Nothing cached yet. Use --route N --segments … (see --list-segments).")

    failures = 0
    for loc, date in jobs:
        print(f"Analysing {loc['id']} near {date} …", flush=True)
        try:
            r = analyse(loc, date, provider=a.provider, allow_fetch_roads=a.fetch_roads, buffer_m=a.buffer_m,
                        max_days=a.max_days, max_cloud=a.max_cloud)
            print("  " + summary(r))
        except (SatelliteError, RouteError, requests.RequestException) as err:
            failures += 1
            print(f"  FAILED: {err}")
    manifest = write_manifest()
    print(f"Manifest: data/satellite/cache_manifest.js ({len(manifest['analyses'])} cached analyses)")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
