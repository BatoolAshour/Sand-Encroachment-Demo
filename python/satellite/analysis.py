"""
analysis.py — one complete satellite analysis, written into the local cache.

    analyse(location, date) -> result dict (also saved as result.json)

`location` is a route segment (find_segment) or a custom point
(custom_location). For a route segment the road is the KMZ centreline and
the measurements cover the segment's part of the KMZ 2 km study area.

Files written to data/satellite/cache/<location_id>/<scene_date>/:
    original.jpg   Sentinel-2 true colour (B04/B03/B02), 10 m pixels
    overlay.jpg    the same image with detected sand, study area, road buffer and road
    result.json    measurements, scene metadata, method and parameters
"""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

from . import processing, roads
from . import routes as routes_mod
from .providers import SatelliteError, area_from_bounds, fetch_bands, get_provider, make_area

SCHEMA = "pro01-satellite-analysis/1.1"
PROCESSING_VERSION = "1.1"
DEFAULT_BUFFER_M = 200
MIN_BUFFER_M, MAX_BUFFER_M = 10, routes_mod.STUDY_HALF_WIDTH_M

REPO_ROOT = Path(__file__).resolve().parents[2]
SAT_DIR = REPO_ROOT / "data" / "satellite"
CACHE_DIR = SAT_DIR / "cache"
ROADS_DIR = SAT_DIR / "roads"            # road files for custom points (OpenStreetMap)
ROUTES_DIR = SAT_DIR / "routes"
ROUTES_FILE = SAT_DIR / "routes.json"

# Overlay colours (RGB) — the legend in index.html uses the same colours.
SAND_RGB = (225, 29, 116)
EXCLUDED_RGB = (100, 116, 139)
ROAD_RGB = (255, 214, 0)
BUFFER_RGB = (255, 255, 255)
STUDY_RGB = (0, 229, 255)


def load_routes():
    if not ROUTES_FILE.exists():
        return []
    return json.loads(ROUTES_FILE.read_text(encoding="utf-8"))["routes"]


def find_route(route_id):
    return next((r for r in load_routes() if r["id"] == route_id), None)


def find_segment(segment_id):
    """Segment id (e.g. route3_al_ahsa_salwa_s04) -> location dict for analyse(), or None."""
    for route in load_routes():
        for seg in route["segments"]:
            if seg["id"] == segment_id:
                return {
                    "id": seg["id"],
                    "name": f"{route['name']} · segment {seg['index']} of {len(route['segments'])}",
                    "lat": seg["center"][1], "lon": seg["center"][0],
                    "route": {k: route[k] for k in ("id", "number", "name", "from", "to", "length_m",
                                                    "source_kmz", "sha256", "geojson", "study_half_width_m")},
                    "segment": {**seg, "count": len(route["segments"])},
                    "default_date": route.get("default_date"),
                }
    return None


def find_location(location_id):
    """Kept for the API: a location id is now a segment id."""
    return find_segment(location_id)


def custom_location(lat, lon, size_m=5000):
    return {"id": f"custom_{lat:.4f}_{lon:.4f}".replace("-", "m").replace(".", "p"),
            "name": f"Custom point {lat:.4f}°N, {lon:.4f}°E", "lat": lat, "lon": lon,
            "size_m": size_m, "custom": True}


def _blend(img, mask, rgb, alpha):
    img[mask] = (img[mask] * (1 - alpha) + np.array(rgb) * alpha).astype("uint8")


def _outline(mask):
    return mask & ~ndimage.binary_erosion(mask, border_value=1)


def render_images(masks, road_mask, road_dist, buffer_m, region=None):
    original = (masks["rgb"] * 255).astype("uint8")
    overlay = (original * 0.8).astype("uint8")
    sand = masks["sand"] if region is None else masks["sand"] & region
    _blend(overlay, sand, SAND_RGB, 0.45)
    _blend(overlay, ~masks["valid"], EXCLUDED_RGB, 0.7)
    if region is not None:
        _blend(overlay, ~region, (0, 0, 0), 0.55)                 # outside this segment's study area
        _blend(overlay, ndimage.binary_dilation(_outline(region)), STUDY_RGB, 0.9)
    if road_dist is not None:
        strip = road_dist <= buffer_m
        if region is not None:
            strip &= region
        _blend(overlay, _outline(strip), BUFFER_RGB, 0.9)
        _blend(overlay, ndimage.binary_dilation(road_mask), ROAD_RGB, 0.95)
    return Image.fromarray(original), Image.fromarray(overlay)


def check_buffer(buffer_m):
    buffer_m = int(buffer_m)
    if not MIN_BUFFER_M <= buffer_m <= MAX_BUFFER_M:
        raise SatelliteError(f"Road buffer must be {MIN_BUFFER_M}–{MAX_BUFFER_M} m (inside the 2 km study area).")
    return buffer_m


def prepare_segment(location):
    """Area, KMZ road and segment mask for a route segment; validated before any download."""
    seg, route = location["segment"], location["route"]
    area = area_from_bounds(location["lat"], location["lon"], seg["epsg"], seg["bounds_utm"])
    line, ring, props = routes_mod.load_route_geometry(REPO_ROOT / route["geojson"])
    region, seg_line = routes_mod.segment_region(area, line, ring, seg)
    if region.sum() < 0.05 * region.size:
        raise SatelliteError(f"Segment {seg['id']}: the study area covers almost none of the image; "
                             "re-run python import_routes.py.")
    road_geom = {"type": "LineString", "coordinates": line}
    road_dist, reason = roads.road_distance(area, road_geom)
    if road_dist is None:
        raise SatelliteError(f"Segment {seg['id']}: {reason}.")
    road_info = {"available": True, "method": "kmz",
                 "source": f"Route centreline from {Path(route['source_kmz']).name} (unchanged KMZ coordinates)",
                 "note": None}
    return area, region, road_geom, road_dist, road_info


def analyse(location, date, provider="auto", allow_fetch_roads=False,
            buffer_m=DEFAULT_BUFFER_M, max_days=15, max_cloud=30):
    buffer_m = check_buffer(buffer_m)
    region = None
    if "segment" in location:
        area, region, road_geom, road_dist, road_info = prepare_segment(location)
    else:
        area = make_area(location["lat"], location["lon"], int(location.get("size_m", 5000)))
        road_geom, road_info = roads.resolve_road(area, location["id"], ROADS_DIR, allow_fetch=allow_fetch_roads)
        road_dist = None
        if road_geom is not None:
            road_dist, reason = roads.road_distance(area, road_geom)
            if road_dist is None:
                road_info = {"available": False, "reason": reason, "source": road_info.get("source")}

    prov = get_provider(provider)
    scene, band_data = fetch_bands(prov, area, date, max_days=max_days, max_cloud=max_cloud, region=region)

    masks, diagnostics = processing.detect_sand(band_data)
    road_mask = roads.road_mask_for_drawing(area, road_geom) if road_dist is not None else None

    measurements = processing.measure(masks, road_dist, buffer_m=buffer_m, region=region)
    if road_dist is None:
        measurements["distance_to_road_m_reason"] = f"no valid road geometry ({road_info.get('reason')})"

    out_dir = CACHE_DIR / location["id"] / scene.date
    out_dir.mkdir(parents=True, exist_ok=True)
    original, overlay = render_images(masks, road_mask, road_dist, buffer_m, region)
    original.save(out_dir / "original.jpg", quality=90, subsampling=0)
    overlay.save(out_dir / "overlay.jpg", quality=90, subsampling=0)

    rel = out_dir.relative_to(REPO_ROOT).as_posix()
    w, s, e, n = area.wgs84_bounds()
    result = {
        "schema": SCHEMA,
        "data_kind": "satellite-derived",
        "disclaimer": ("Derived from real Sentinel-2 satellite imagery. Not a measurement from the "
                       "physical prototype (sand_01 / wind_01). Rule-based detection, not validated in the field."),
        "location": {
            "id": location["id"], "name": location["name"], "lat": location["lat"], "lon": location["lon"],
            "size_m": area.size_m, "width_m": area.width_m, "height_m": area.height_m, "epsg": area.epsg,
            "bounds_wgs84": [round(w, 6), round(s, 6), round(e, 6), round(n, 6)],
        },
        "route": location.get("route"),
        "segment": location.get("segment"),
        "analysis_area": {
            "basis": ("segment part of the 2 km study area (KMZ)" if region is not None
                      else f"whole {area.width_m / 1000:g} × {area.height_m / 1000:g} km image"),
            "study_half_width_m": location["route"]["study_half_width_m"] if region is not None else None,
            "road_buffer_m": buffer_m,
            "image_km": [area.width_m / 1000, area.height_m / 1000],
        },
        "requested_date": date,
        "scene": {
            "id": scene.scene_id, "date": scene.date, "datetime": scene.datetime,
            "tile_cloud_pct": None if scene.tile_cloud_pct is None else round(float(scene.tile_cloud_pct), 2),
            "collection": "Sentinel-2 Level-2A (surface reflectance)", "resolution_m": 10,
            "provider": scene.provider,
            "mosaic_tiles": scene.extra.get("mosaic_tiles", []),
            "attribution": "Contains modified Copernicus Sentinel data " + scene.date[:4],
        },
        "road": road_info,
        "measurements": measurements,
        "processing": {
            "version": PROCESSING_VERSION,
            "processed_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "steps": [
                *(["analysis area: segment part of the KMZ 2 km study area (pixels nearer to this segment "
                   "than to the rest of the route); road = KMZ centreline"] if region is not None else []),
                "valid pixels from the Scene Classification Layer (clouds, shadow, cirrus, water, no-data removed)",
                "colour segmentation in HSV (sand hue range, Otsu saturation threshold)",
                "thresholding: Bare Soil Index > 0, NDVI < 0.15, brightness above asphalt/shadow",
                "texture analysis: local standard deviation (5 x 5 px) must be low",
                "morphology: opening, closing, removal of patches and holes < 0.25 ha",
            ],
            "parameters": {
                "sand_hue_deg": processing.SAND_HUE_DEG, "saturation_bounds": processing.SAT_BOUNDS,
                "min_brightness": processing.MIN_BRIGHTNESS, "min_bsi": processing.MIN_BSI,
                "max_ndvi_sand": processing.MAX_NDVI_SAND, "vegetation_ndvi": processing.VEGETATION_NDVI,
                "texture_window_px": processing.TEXTURE_WINDOW, "max_texture": processing.MAX_TEXTURE,
                "min_patch_px": processing.MIN_PATCH_PX, "buffer_m": buffer_m,
            },
            "diagnostics": diagnostics,
        },
        "images": {"original": f"{rel}/original.jpg", "overlay": f"{rel}/overlay.jpg"},
    }
    (out_dir / "result.json").write_text(json.dumps(result, indent=2, default=_json_default), encoding="utf-8")
    return result


def _json_default(o):
    if isinstance(o, np.generic):
        return o.item()
    if isinstance(o, tuple):
        return list(o)
    raise TypeError(type(o).__name__)
