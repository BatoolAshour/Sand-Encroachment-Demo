"""
import_routes.py — turn the research-route KMZ files into the files the
satellite analysis and the dashboard use.

    python import_routes.py                    # all KMZ in data/satellite/routes/source/
    python import_routes.py --segment-km 4     # other segment length

Reads   data/satellite/routes/source/*Route<N>*.kmz
Writes  data/satellite/routes/<route_id>.geojson   centreline + 2 km study area,
                                                   coordinates copied unchanged
        data/satellite/routes.json                 routes, validation report, segments
and rebuilds data/satellite/cache_manifest.js.

Every KMZ is validated first (coordinate system, closed polygon, centreline
inside the study area, study-area width about 2 km). Nothing is written if
a file fails.
"""

import argparse
import json
import sys

from satellite.analysis import ROUTES_DIR, ROUTES_FILE, SAT_DIR
from satellite.routes import (DEFAULT_SEGMENT_LENGTH_M, ROUTE_ID_RE, STUDY_HALF_WIDTH_M, RouteError,
                              build_segments, import_kmz, route_geojson, validate_route)

SOURCE_DIR = ROUTES_DIR / "source"

# Display names of the research routes (route number -> start, end).
ROUTE_NAMES = {
    3: ("Al-Ahsa", "Salwa"),
    4: ("Abqaiq", "Salasil"),
    5: ("Al-Ahsa", "Riyadh"),
}
DEFAULT_DATE = "2026-10-20"
DEFAULT_ROAD_BUFFER_M = 200


def slug(text):
    return "".join(c if c.isalnum() else "_" for c in text.lower()).strip("_").replace("__", "_")


def main():
    p = argparse.ArgumentParser(description="Import research-route KMZ files")
    p.add_argument("--segment-km", type=float, default=DEFAULT_SEGMENT_LENGTH_M / 1000,
                   help="target segment length along the road (km, default 5)")
    a = p.parse_args()

    files = sorted(SOURCE_DIR.glob("*.kmz"))
    if not files:
        sys.exit(f"No KMZ files in {SOURCE_DIR}")

    routes, outputs = [], []
    for path in files:
        m = ROUTE_ID_RE.search(path.stem)
        if not m or int(m.group(1)) not in ROUTE_NAMES:
            sys.exit(f"{path.name}: route number not recognised (expected Route3/4/5 in the file name)")
        number = int(m.group(1))
        start, end = ROUTE_NAMES[number]
        route_id = f"route{number}_{slug(start)}_{slug(end)}"
        try:
            kmz = import_kmz(path)
            report = validate_route(kmz)
        except RouteError as err:
            sys.exit(f"INVALID: {err}")
        segments, total = build_segments(route_id, kmz["centerline"], a.segment_km * 1000)
        route = {
            "id": route_id,
            "number": number,
            "name": f"Route {number}: {start} – {end}",
            "from": start,
            "to": end,
            "source_kmz": f"data/satellite/routes/source/{path.name}",
            "kml_document": kmz["document_name"],
            "sha256": kmz["sha256"],
            "geojson": f"data/satellite/routes/{route_id}.geojson",
            "length_m": round(total, 1),
            "study_half_width_m": STUDY_HALF_WIDTH_M,
            "default_date": DEFAULT_DATE,
            "validation": report,
            "segments": segments,
        }
        routes.append(route)
        outputs.append((ROUTES_DIR / f"{route_id}.geojson", route_geojson(route, kmz, report)))
        hw = report["study_half_width_m"]
        print(f"OK  {route['name']:<28} {total / 1000:6.1f} km, {len(segments):3d} segments "
              f"(~{total / len(segments) / 1000:.2f} km), {report['centerline_points']} centreline pts, "
              f"study half-width {hw['min_m']}–{hw['max_m']} m (median {hw['median_m']}), {report['analysis_crs']}")

    routes.sort(key=lambda r: r["number"])
    for path, data in outputs:
        path.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    ROUTES_FILE.write_text(json.dumps({
        "description": ("Research routes for the Satellite Monitoring section, imported from the KMZ files in "
                        "routes/source/ by python/import_routes.py. Do not edit by hand."),
        "study_half_width_m": STUDY_HALF_WIDTH_M,
        "segment_length_m": round(a.segment_km * 1000),
        "default_road_buffer_m": DEFAULT_ROAD_BUFFER_M,
        "routes": routes,
    }, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {ROUTES_FILE.relative_to(SAT_DIR.parents[1])} and {len(outputs)} GeoJSON files.")

    from satellite.cache import write_manifest
    write_manifest()


if __name__ == "__main__":
    main()
