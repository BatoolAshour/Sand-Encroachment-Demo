"""
analysis.py — one complete satellite analysis, written into the local cache.

    analyse(location, date) -> result dict (also saved as result.json)

Files written to data/satellite/cache/<location_id>/<scene_date>/:
    original.png   Sentinel-2 true colour (B04/B03/B02), 10 m pixels
    overlay.png    the same image with detected sand, excluded pixels and road
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
from .providers import fetch_bands, get_provider, make_area

SCHEMA = "pro01-satellite-analysis/1.0"
PROCESSING_VERSION = "1.0"
DEFAULT_BUFFER_M = 200

REPO_ROOT = Path(__file__).resolve().parents[2]
SAT_DIR = REPO_ROOT / "data" / "satellite"
CACHE_DIR = SAT_DIR / "cache"
ROADS_DIR = SAT_DIR / "roads"
LOCATIONS_FILE = SAT_DIR / "locations.json"

# Overlay colours (RGB) — the legend in index.html uses the same colours.
SAND_RGB = (225, 29, 116)
EXCLUDED_RGB = (100, 116, 139)
ROAD_RGB = (255, 214, 0)
BUFFER_RGB = (255, 255, 255)


def load_locations():
    return json.loads(LOCATIONS_FILE.read_text(encoding="utf-8"))["locations"]


def find_location(location_id):
    for loc in load_locations():
        if loc["id"] == location_id:
            return loc
    return None


def custom_location(lat, lon, size_m=5000):
    return {"id": f"custom_{lat:.4f}_{lon:.4f}".replace("-", "m").replace(".", "p"),
            "name": f"Custom point {lat:.4f}°N, {lon:.4f}°E", "lat": lat, "lon": lon,
            "size_m": size_m, "custom": True}


def _blend(img, mask, rgb, alpha):
    img[mask] = (img[mask] * (1 - alpha) + np.array(rgb) * alpha).astype("uint8")


def render_images(masks, road_mask, road_dist, buffer_m):
    original = (masks["rgb"] * 255).astype("uint8")
    overlay = (original * 0.8).astype("uint8")
    _blend(overlay, masks["sand"], SAND_RGB, 0.45)
    _blend(overlay, ~masks["valid"], EXCLUDED_RGB, 0.7)
    if road_dist is not None:
        strip = road_dist <= buffer_m
        edge = strip & ~ndimage.binary_erosion(strip, border_value=1)
        _blend(overlay, edge, BUFFER_RGB, 0.9)
        _blend(overlay, ndimage.binary_dilation(road_mask), ROAD_RGB, 0.95)
    return Image.fromarray(original), Image.fromarray(overlay)


def analyse(location, date, provider="auto", allow_fetch_roads=False,
            buffer_m=DEFAULT_BUFFER_M, max_days=15, max_cloud=30):
    area = make_area(location["lat"], location["lon"], int(location.get("size_m", 5000)))
    prov = get_provider(provider)
    scene, band_data = fetch_bands(prov, area, date, max_days=max_days, max_cloud=max_cloud)

    masks, diagnostics = processing.detect_sand(band_data)

    road_geom, road_info = roads.resolve_road(area, location["id"], ROADS_DIR, allow_fetch=allow_fetch_roads)
    road_dist = road_mask = None
    if road_geom is not None:
        road_dist, reason = roads.road_distance(area, road_geom)
        if road_dist is None:
            road_info = {"available": False, "reason": reason, "source": road_info.get("source")}
        else:
            road_mask = roads.road_mask_for_drawing(area, road_geom)

    measurements = processing.measure(masks, road_dist, buffer_m=buffer_m)
    if road_dist is None:
        measurements["distance_to_road_m_reason"] = f"no valid road geometry ({road_info.get('reason')})"

    out_dir = CACHE_DIR / location["id"] / scene.date
    out_dir.mkdir(parents=True, exist_ok=True)
    original, overlay = render_images(masks, road_mask, road_dist, buffer_m)
    original.save(out_dir / "original.png", optimize=True)
    overlay.save(out_dir / "overlay.png", optimize=True)

    rel = out_dir.relative_to(REPO_ROOT).as_posix()
    w, s, e, n = area.wgs84_bounds()
    result = {
        "schema": SCHEMA,
        "data_kind": "satellite-derived",
        "disclaimer": ("Derived from real Sentinel-2 satellite imagery. Not a measurement from the "
                       "physical prototype (sand_01 / wind_01). Rule-based detection, not validated in the field."),
        "location": {
            "id": location["id"], "name": location["name"], "lat": location["lat"], "lon": location["lon"],
            "size_m": area.size_m, "epsg": area.epsg,
            "bounds_wgs84": [round(w, 6), round(s, 6), round(e, 6), round(n, 6)],
        },
        "requested_date": date,
        "scene": {
            "id": scene.scene_id, "date": scene.date, "datetime": scene.datetime,
            "tile_cloud_pct": None if scene.tile_cloud_pct is None else round(float(scene.tile_cloud_pct), 2),
            "collection": "Sentinel-2 Level-2A (surface reflectance)", "resolution_m": 10,
            "provider": scene.provider,
            "attribution": "Contains modified Copernicus Sentinel data " + scene.date[:4],
        },
        "road": road_info,
        "measurements": measurements,
        "processing": {
            "version": PROCESSING_VERSION,
            "processed_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "steps": [
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
        "images": {"original": f"{rel}/original.png", "overlay": f"{rel}/overlay.png"},
    }
    (out_dir / "result.json").write_text(json.dumps(result, indent=2, default=_json_default), encoding="utf-8")
    return result


def _json_default(o):
    if isinstance(o, np.generic):
        return o.item()
    if isinstance(o, tuple):
        return list(o)
    raise TypeError(type(o).__name__)
