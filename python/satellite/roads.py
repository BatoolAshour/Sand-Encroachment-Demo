"""
roads.py — road centreline for an area, and the distance of every pixel to it.

Where road geometry comes from (first match wins):
  1. data/satellite/roads/<location_id>.geojson   (shipped or user-provided)
  2. OpenStreetMap via the Overpass API, only when fetching is allowed
     (online); the result is saved as (1) so it also works offline later.

Geometry is "valid" only if it is a LineString / MultiLineString in WGS84
with at least two points inside the analysed area. Otherwise the distance
to the road is NOT computed and the reason is reported.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import requests
from rasterio.features import rasterize
from rasterio.warp import transform_geom
from scipy import ndimage

from .providers import CA_BUNDLE

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OSM_HIGHWAY_CLASSES = "motorway|trunk|primary|secondary"


def _lines(geom):
    if geom.get("type") == "LineString":
        return [geom["coordinates"]]
    if geom.get("type") == "MultiLineString":
        return geom["coordinates"]
    return []


def load_road(path):
    """Read a GeoJSON file -> (geometry, properties) or (None, reason)."""
    path = Path(path)
    if not path.exists():
        return None, "no road geometry file"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as err:
        return None, f"road file unreadable ({err})"
    feats = data.get("features", [data]) if data.get("type") == "FeatureCollection" else [data]
    lines, props = [], {}
    for f in feats:
        geom = f.get("geometry", f)
        lines += _lines(geom)
        props = props or f.get("properties", {}) or {}
    if not lines:
        return None, "road file has no LineString geometry"
    props.update(data.get("properties", {}) if data.get("type") == "FeatureCollection" else {})
    return {"type": "MultiLineString", "coordinates": lines}, props


def fetch_osm_road(area, out_path):
    """Download major roads from OpenStreetMap for the area and save them as GeoJSON."""
    w, s, e, n = area.wgs84_bounds()
    query = f'[out:json][timeout:60];way["highway"~"^({OSM_HIGHWAY_CLASSES})$"]({s},{w},{n},{e});out geom;'
    r = requests.post(OVERPASS_URL, data={"data": query}, timeout=90, verify=CA_BUNDLE)
    if r.status_code != 200:
        return None, f"OpenStreetMap request failed ({r.status_code})"
    ways = [el for el in r.json().get("elements", []) if el.get("type") == "way" and el.get("geometry")]
    if not ways:
        return None, "no major road in OpenStreetMap for this area"
    fc = {
        "type": "FeatureCollection",
        "properties": {"source": "OpenStreetMap contributors (ODbL), via Overpass API",
                       "method": "osm", "highway_classes": OSM_HIGHWAY_CLASSES},
        "features": [{
            "type": "Feature",
            "properties": {"osm_id": wy["id"], "highway": wy.get("tags", {}).get("highway"),
                           "ref": wy.get("tags", {}).get("ref"), "name": wy.get("tags", {}).get("name")},
            "geometry": {"type": "LineString", "coordinates": [[p["lon"], p["lat"]] for p in wy["geometry"]]},
        } for wy in ways],
    }
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    Path(out_path).write_text(json.dumps(fc, indent=1), encoding="utf-8")
    return load_road(out_path)


def road_distance(area, geom_wgs84):
    """Distance (m) from every pixel to the road centreline, or (None, reason)."""
    utm = transform_geom("EPSG:4326", f"EPSG:{area.epsg}", geom_wgs84)
    minx, miny, maxx, maxy = area.bounds
    inside = sum(1 for line in _lines(utm) for x, y in line if minx <= x <= maxx and miny <= y <= maxy)
    if inside < 2:
        return None, "road geometry does not cross the analysed area"
    road = rasterize([(utm, 1)], out_shape=area.shape, transform=area.transform,
                     all_touched=True, dtype="uint8").astype(bool)
    if not road.any():
        return None, "road geometry does not cross the analysed area"
    return ndimage.distance_transform_edt(~road) * (area.bounds[2] - area.bounds[0]) / area.shape[1], None


def road_mask_for_drawing(area, geom_wgs84):
    utm = transform_geom("EPSG:4326", f"EPSG:{area.epsg}", geom_wgs84)
    return rasterize([(utm, 1)], out_shape=area.shape, transform=area.transform,
                     all_touched=True, dtype="uint8").astype(bool)


def pixel_line_to_geojson(area, pixels):
    """Helper for tracing: [(col, row), …] pixel centres -> WGS84 LineString coordinates."""
    from rasterio.warp import transform as warp_transform
    minx, _, _, maxy = area.bounds
    xs = [minx + (c + 0.5) * 10 for c, _ in pixels]
    ys = [maxy - (r + 0.5) * 10 for _, r in pixels]
    lons, lats = warp_transform(f"EPSG:{area.epsg}", "EPSG:4326", xs, ys)
    return [[round(lo, 6), round(la, 6)] for lo, la in zip(lons, lats)]


def resolve_road(area, location_id, roads_dir, allow_fetch=False):
    """Returns (geometry or None, info dict). info explains the source or why there is none."""
    path = Path(roads_dir) / f"{location_id}.geojson"
    geom, props = load_road(path)
    if geom is None and allow_fetch:
        try:
            geom, props = fetch_osm_road(area, path)
        except (requests.RequestException, ValueError) as err:
            geom, props = None, f"OpenStreetMap not reachable ({type(err).__name__})"
    if geom is None:
        return None, {"available": False, "reason": props}
    return geom, {"available": True, "source": props.get("source", "unknown"),
                  "method": props.get("method", "unknown"), "note": props.get("note")}
