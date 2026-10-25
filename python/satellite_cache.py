"""
satellite_cache.py — download and analyse real Sentinel-2 images ahead of a demo.

The results are stored in data/satellite/cache/ and listed in
data/satellite/cache_manifest.js, so the dashboard can show them later
WITHOUT internet (also when index.html is opened by double-click).

Examples:
    python satellite_cache.py                              # every location, its default date
    python satellite_cache.py --location dahna_highway --date 2026-09-15
    python satellite_cache.py --lat 24.90 --lon 50.65 --date 2026-10-20
    python satellite_cache.py --refresh-roads              # replace road traces with OpenStreetMap
    python satellite_cache.py --list                       # show what is cached
    python satellite_cache.py --manifest-only              # rebuild cache_manifest.js

Provider: Copernicus Data Space Ecosystem when CDSE_CLIENT_ID and
CDSE_CLIENT_SECRET are set, otherwise the public AWS Sentinel-2 archive.
"""

import argparse
import sys

import requests

from satellite.analysis import ROADS_DIR, analyse, custom_location, find_location, load_locations
from satellite.cache import cached_results, write_manifest
from satellite.providers import SatelliteError, make_area
from satellite.roads import fetch_osm_road


def summary(r):
    m = r["measurements"]
    dist = f"{m['distance_to_road_m']} m" if m["distance_to_road_m"] is not None else "n/a"
    strip = f"{m['sand_coverage_pct']}% in {m['buffer_m']} m road strip" if m["sand_coverage_pct"] is not None else "no road strip"
    return (f"{r['location']['id']:<22} scene {r['scene']['date']} ({r['scene']['id']})  "
            f"sand {m['area_sand_coverage_pct']}% of area, {strip}, nearest sand {dist}, valid {m['valid_pct']}%")


def main():
    p = argparse.ArgumentParser(description="Pre-cache real Sentinel-2 sand analyses for offline demos")
    p.add_argument("--location", help="location id from data/satellite/locations.json (default: all)")
    p.add_argument("--lat", type=float)
    p.add_argument("--lon", type=float)
    p.add_argument("--date", help="observation date YYYY-MM-DD (nearest clear scene is used)")
    p.add_argument("--provider", choices=["auto", "cdse", "aws"], default="auto")
    p.add_argument("--max-days", type=int, default=15, help="search window around the date (days)")
    p.add_argument("--max-cloud", type=float, default=30, help="maximum tile cloud cover (%%)")
    p.add_argument("--fetch-roads", action="store_true", help="download road geometry from OpenStreetMap if missing")
    p.add_argument("--refresh-roads", action="store_true", help="replace road files with OpenStreetMap geometry")
    p.add_argument("--list", action="store_true")
    p.add_argument("--manifest-only", action="store_true")
    a = p.parse_args()

    if a.list:
        for r in cached_results():
            print(summary(r))
        return
    if a.manifest_only:
        print(f"Manifest written with {len(write_manifest()['analyses'])} analyses.")
        return

    if a.lat is not None or a.lon is not None:
        if a.lat is None or a.lon is None or not a.date:
            sys.exit("--lat, --lon and --date are needed together.")
        locations = [custom_location(a.lat, a.lon)]
    elif a.location:
        loc = find_location(a.location)
        if not loc:
            sys.exit(f"Unknown location '{a.location}'. Known: {', '.join(l['id'] for l in load_locations())}")
        locations = [loc]
    else:
        locations = load_locations()

    if a.refresh_roads:
        for loc in locations:
            area = make_area(loc["lat"], loc["lon"], loc.get("size_m", 5000))
            try:
                geom, info = fetch_osm_road(area, ROADS_DIR / f"{loc['id']}.geojson")
                print(f"{loc['id']}: " + ("OpenStreetMap road saved" if geom else f"kept existing road ({info})"))
            except requests.RequestException as err:
                print(f"{loc['id']}: OpenStreetMap not reachable ({err.__class__.__name__}); kept existing road")

    failures = 0
    for loc in locations:
        date = a.date or loc.get("default_date")
        print(f"Analysing {loc['id']} near {date} …", flush=True)
        try:
            r = analyse(loc, date, provider=a.provider, allow_fetch_roads=a.fetch_roads,
                        max_days=a.max_days, max_cloud=a.max_cloud)
            print("  " + summary(r))
        except (SatelliteError, requests.RequestException) as err:
            failures += 1
            print(f"  FAILED: {err}")
    manifest = write_manifest()
    print(f"Manifest: data/satellite/cache_manifest.js ({len(manifest['analyses'])} cached analyses)")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
