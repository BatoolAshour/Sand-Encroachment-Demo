"""
routes.py — the research routes (KMZ) and their analysis segments.

Each KMZ in data/satellite/routes/source/ holds two placemarks:
    LineString   the road centreline
    Polygon      the study area, 2 km on each side of the centreline

import_kmz() reads them WITHOUT changing a coordinate (KML is always WGS84
lon/lat, EPSG:4326), validate_route() checks the geometry, and
build_segments() cuts the centreline into analysis segments of a fixed
length, measured along the road from the first point of the line.

Each segment gets one image area: the bounding box (in the UTM zone of the
segment's midpoint, snapped to the 10 m Sentinel-2 grid) of every point
within the study half-width of the segment. Inside that image, the
analysis only uses pixels that are inside the KMZ study area AND closer to
this segment than to the rest of the route (segment_region()).
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
from rasterio import transform as rasterio_transform
from rasterio.features import rasterize
from rasterio.warp import transform as warp_transform
from rasterio.warp import transform_geom
from scipy import ndimage

KML_NS = {"k": "http://www.opengis.net/kml/2.2"}
PIXEL_M = 10
STUDY_HALF_WIDTH_M = 2000          # stated in the KMZ names ("2 km study area each side")
DEFAULT_SEGMENT_LENGTH_M = 5000
SAUDI_BBOX = (34.0, 16.0, 56.0, 33.0)   # lon/lat sanity range (W, S, E, N)


class RouteError(ValueError):
    """The KMZ cannot be used as a research route (the message says why)."""


# ---------------------------------------------------------------------------
# KMZ -> exact coordinates
# ---------------------------------------------------------------------------
def _coords(text):
    """KML <coordinates> text -> [[lon, lat], …] (altitude checked separately)."""
    pts, alts = [], []
    for tup in text.split():
        parts = tup.split(",")
        if len(parts) not in (2, 3):
            raise RouteError(f"bad coordinate tuple '{tup}'")
        pts.append([float(parts[0]), float(parts[1])])
        alts.append(float(parts[2]) if len(parts) == 3 else 0.0)
    return pts, alts


def import_kmz(path):
    """Read one route KMZ -> dict with the centreline, the study-area ring and provenance."""
    path = Path(path)
    raw = path.read_bytes()
    with zipfile.ZipFile(path) as z:
        kml_names = [n for n in z.namelist() if n.lower().endswith(".kml")]
        if len(kml_names) != 1:
            raise RouteError(f"{path.name}: expected one .kml inside the KMZ, found {kml_names}")
        root = ET.fromstring(z.read(kml_names[0]))
    if not root.tag.startswith("{" + KML_NS["k"]):
        raise RouteError(f"{path.name}: not a KML 2.2 document")

    lines, polygons = [], []
    for pm in root.iterfind(".//k:Placemark", KML_NS):
        name = (pm.findtext("k:name", default="", namespaces=KML_NS) or "").strip()
        for ls in pm.iterfind(".//k:LineString/k:coordinates", KML_NS):
            lines.append((name, *_coords(ls.text)))
        for poly in pm.iterfind(".//k:Polygon", KML_NS):
            if poly.find("k:innerBoundaryIs", KML_NS) is not None:
                raise RouteError(f"{path.name}: study area has holes (not supported)")
            ring = poly.find("k:outerBoundaryIs/k:LinearRing/k:coordinates", KML_NS)
            polygons.append((name, *_coords(ring.text)))
    if len(lines) != 1 or len(polygons) != 1:
        raise RouteError(f"{path.name}: expected 1 centreline and 1 study-area polygon, "
                         f"found {len(lines)} lines and {len(polygons)} polygons")
    (line_name, line, line_alt), (poly_name, ring, ring_alt) = lines[0], polygons[0]
    return {
        "document_name": (root.findtext("k:Document/k:name", default="", namespaces=KML_NS) or "").strip(),
        "centerline_name": line_name,
        "study_area_name": poly_name,
        "centerline": line,
        "study_area": ring,
        "altitudes": sorted(set(line_alt + ring_alt)),
        "source_file": path.name,
        "sha256": hashlib.sha256(raw).hexdigest(),
    }


# ---------------------------------------------------------------------------
# Geometry helpers (metres in UTM)
# ---------------------------------------------------------------------------
def utm_epsg(lon, lat):
    return (32600 if lat >= 0 else 32700) + int((lon + 180) // 6) + 1


def to_utm(coords, epsg):
    xs, ys = warp_transform("EPSG:4326", f"EPSG:{epsg}", [c[0] for c in coords], [c[1] for c in coords])
    return np.column_stack([xs, ys])


def step_lengths(coords):
    """Length (m) of every step of a lon/lat polyline, each in the UTM zone of its midpoint."""
    out = np.zeros(len(coords) - 1)
    zones = {}
    for i, (a, b) in enumerate(zip(coords, coords[1:])):
        zones.setdefault(utm_epsg((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), []).append(i)
    for epsg, idx in zones.items():
        xy = to_utm(coords, epsg)
        for i in idx:
            out[i] = float(np.hypot(*(xy[i + 1] - xy[i])))
    return out


def point_in_ring(pts, ring):
    """Even-odd rule for many points (N, 2) against one ring (M, 2)."""
    x, y = pts[:, 0][:, None], pts[:, 1][:, None]
    x1, y1 = ring[:-1, 0][None, :], ring[:-1, 1][None, :]
    x2, y2 = ring[1:, 0][None, :], ring[1:, 1][None, :]
    crosses = ((y1 > y) != (y2 > y)) & (x < (x2 - x1) * (y - y1) / np.where(y2 == y1, 1e-30, y2 - y1) + x1)
    return crosses.sum(axis=1) % 2 == 1


def distance_to_polyline(pts, line):
    """Shortest distance from each point (N, 2) to a polyline (M, 2), same planar units."""
    a, b = line[:-1][None], line[1:][None]
    p = pts[:, None]
    ab = b - a
    t = np.clip(((p - a) * ab).sum(-1) / np.maximum((ab * ab).sum(-1), 1e-12), 0, 1)
    return np.hypot(*np.moveaxis(p - (a + t[..., None] * ab), -1, 0)).min(axis=1)


# ---------------------------------------------------------------------------
# Validation (coordinate system, geometry, study-area width)
# ---------------------------------------------------------------------------
def validate_route(kmz):
    """Checks a parsed KMZ; raises RouteError on a problem, returns a report otherwise."""
    line, ring = kmz["centerline"], kmz["study_area"]
    name = kmz["source_file"]
    w, s, e, n = SAUDI_BBOX
    for label, pts in (("centreline", line), ("study area", ring)):
        for lon, lat in pts:
            if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                raise RouteError(f"{name}: {label} has a coordinate outside lon/lat range ({lon}, {lat})")
            if not (w <= lon <= e and s <= lat <= n):
                raise RouteError(f"{name}: {label} point ({lon}, {lat}) is outside Saudi Arabia; "
                                 "the file may use another coordinate system or swapped lat/lon")
    if kmz["altitudes"] != [0.0]:
        raise RouteError(f"{name}: unexpected altitudes {kmz['altitudes'][:5]} (2-D route expected)")
    if len(line) < 2:
        raise RouteError(f"{name}: centreline needs at least 2 points")
    if ring[0] != ring[-1] or len(ring) < 4:
        raise RouteError(f"{name}: study-area polygon is not a closed ring")

    # Work in one UTM zone per check (the route's middle); the width check is
    # local, so the small scale error far from that zone does not matter.
    lons = [p[0] for p in line]
    lats = [p[1] for p in line]
    epsg = utm_epsg((min(lons) + max(lons)) / 2, (min(lats) + max(lats)) / 2)
    line_xy, ring_xy = to_utm(line, epsg), to_utm(ring, epsg)

    inside = point_in_ring(line_xy, ring_xy)
    if not inside.all():
        raise RouteError(f"{name}: {int((~inside).sum())} centreline points lie outside the study area")

    # Half-width of the corridor: distance of each polygon vertex to the centreline.
    d = distance_to_polyline(ring_xy, line_xy)
    half = {"min_m": round(float(d.min()), 1), "median_m": round(float(np.median(d)), 1),
            "max_m": round(float(d.max()), 1)}
    if abs(half["median_m"] - STUDY_HALF_WIDTH_M) > 0.05 * STUDY_HALF_WIDTH_M:
        raise RouteError(f"{name}: study area is {half['median_m']} m from the centreline, "
                         f"not about {STUDY_HALF_WIDTH_M} m")

    # Round-trip check of the reprojection used by the analysis (< 1 cm).
    back = warp_transform(f"EPSG:{epsg}", "EPSG:4326", line_xy[:, 0].tolist(), line_xy[:, 1].tolist())
    err_deg = max(max(abs(a - p[0]) for a, p in zip(back[0], line)), max(abs(b - p[1]) for b, p in zip(back[1], line)))
    if err_deg > 1e-7:
        raise RouteError(f"{name}: reprojection round trip error {err_deg}°")

    length = float(step_lengths(line).sum())
    return {
        "crs": "EPSG:4326 (KML lon/lat)",
        "analysis_crs": sorted({f"EPSG:{utm_epsg(lo, la)}" for lo, la in line}),
        "centerline_points": len(line),
        "study_area_points": len(ring),
        "centerline_inside_study_area": True,
        "study_half_width_m": half,
        "length_m": round(length, 1),
        "bbox_wgs84": [min(lons), min(lats), max(lons), max(lats)],
    }


# ---------------------------------------------------------------------------
# Segments
# ---------------------------------------------------------------------------
def _interp(a, b, f):
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]


def cut_line(coords, steps, start_m, end_m):
    """Part of the polyline between two chainages (m). Original vertices are kept unchanged."""
    cum = np.concatenate([[0.0], np.cumsum(steps)])

    def point_at(m):
        i = int(np.clip(np.searchsorted(cum, m, side="right") - 1, 0, len(steps) - 1))
        f = 0.0 if steps[i] == 0 else (m - cum[i]) / steps[i]
        if f <= 0:
            return i, list(coords[i])
        if f >= 1:
            return i + 1, list(coords[i + 1])
        return i, _interp(coords[i], coords[i + 1], f)

    i0, p0 = point_at(start_m)
    i1, p1 = point_at(end_m)
    inner = [list(c) for c in coords[i0 + 1:i1 + 1] if list(c) != p0 and list(c) != p1]
    return [p0] + inner + [p1]


def build_segments(route_id, coords, segment_length_m=DEFAULT_SEGMENT_LENGTH_M,
                   half_width_m=STUDY_HALF_WIDTH_M, margin_m=100):
    """Equal-length segments along the centreline, about segment_length_m each."""
    steps = step_lengths(coords)
    total = float(steps.sum())
    count = max(1, int(round(total / segment_length_m)))
    edges = np.linspace(0, total, count + 1)          # equal parts, as close to the target length as possible
    segments = []
    for k, (a, b) in enumerate(zip(edges, edges[1:]), start=1):
        part = cut_line(coords, steps, a, b)
        mid = cut_line(coords, steps, (a + b) / 2, (a + b) / 2)[0]
        epsg = utm_epsg(*mid)
        xy = to_utm(part, epsg)
        pad = half_width_m + margin_m
        snap_lo = lambda v: math.floor(v / PIXEL_M) * PIXEL_M
        snap_hi = lambda v: math.ceil(v / PIXEL_M) * PIXEL_M
        bounds = (snap_lo(xy[:, 0].min() - pad), snap_lo(xy[:, 1].min() - pad),
                  snap_hi(xy[:, 0].max() + pad), snap_hi(xy[:, 1].max() + pad))
        xs, ys = warp_transform(f"EPSG:{epsg}", "EPSG:4326",
                                [bounds[0], bounds[2], bounds[0], bounds[2]], [bounds[1], bounds[1], bounds[3], bounds[3]])
        segments.append({
            "id": f"{route_id}_s{k:02d}",
            "index": k,
            "start_m": round(float(a), 1),
            "end_m": round(float(b), 1),
            "length_m": round(float(b - a), 1),
            "center": [round(mid[0], 6), round(mid[1], 6)],
            "epsg": epsg,
            "bounds_utm": [int(v) for v in bounds],
            "bounds_wgs84": [round(min(xs), 6), round(min(ys), 6), round(max(xs), 6), round(max(ys), 6)],
            "width_m": int(bounds[2] - bounds[0]),
            "height_m": int(bounds[3] - bounds[1]),
        })
    return segments, total


# ---------------------------------------------------------------------------
# Files: data/satellite/routes.json + routes/<id>.geojson
# ---------------------------------------------------------------------------
ROUTE_ID_RE = re.compile(r"Route\s*(\d+)", re.I)


def route_geojson(route, kmz, report):
    return {
        "type": "FeatureCollection",
        "properties": {
            "route_id": route["id"], "name": route["name"],
            "source": f"{kmz['source_file']} (sha256 {kmz['sha256'][:12]}…)",
            "method": "kmz", "crs": "EPSG:4326",
            "note": "Coordinates copied unchanged from the KMZ (altitude 0 dropped).",
            "validation": report,
        },
        "features": [
            {"type": "Feature",
             "properties": {"role": "centerline", "kml_name": kmz["centerline_name"]},
             "geometry": {"type": "LineString", "coordinates": kmz["centerline"]}},
            {"type": "Feature",
             "properties": {"role": "study_area", "kml_name": kmz["study_area_name"],
                            "half_width_m": STUDY_HALF_WIDTH_M},
             "geometry": {"type": "Polygon", "coordinates": [kmz["study_area"]]}},
        ],
    }


def load_route_geometry(path):
    """routes/<id>.geojson -> (centreline coords, study-area ring, properties)."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    line = ring = None
    for f in data["features"]:
        role = f["properties"].get("role")
        if role == "centerline":
            line = f["geometry"]["coordinates"]
        elif role == "study_area":
            ring = f["geometry"]["coordinates"][0]
    if line is None or ring is None:
        raise RouteError(f"{Path(path).name}: centreline or study area missing")
    return line, ring, data.get("properties", {})


def segment_region(area, line, ring, segment):
    """Pixels of `area` inside the study area that belong to this segment (bool mask)."""
    steps = step_lengths(line)
    total = float(steps.sum())
    seg = cut_line(line, steps, segment["start_m"], segment["end_m"])
    before = [cut_line(line, steps, 0, segment["start_m"])] if segment["start_m"] > 0 else []
    after = [cut_line(line, steps, segment["end_m"], total)] if segment["end_m"] < total - 0.5 else []
    crs = f"EPSG:{area.epsg}"
    study = rasterize([(transform_geom("EPSG:4326", crs, {"type": "Polygon", "coordinates": [ring]}), 1)],
                      out_shape=area.shape, transform=area.transform, dtype="uint8").astype(bool)

    # Distances are computed on a grid padded by more than the study half-width,
    # so the nearest part of the route is always on the grid, even when it lies
    # just outside this segment's image.
    pad = int(math.ceil((STUDY_HALF_WIDTH_M + 200) / PIXEL_M))
    rows, cols = area.shape
    padded = rasterio_transform.from_origin(area.bounds[0] - pad * PIXEL_M, area.bounds[3] + pad * PIXEL_M,
                                            PIXEL_M, PIXEL_M)

    def dist(lines):
        if not lines:
            return np.full(area.shape, np.inf)
        g = transform_geom("EPSG:4326", crs, {"type": "MultiLineString", "coordinates": lines})
        m = rasterize([(g, 1)], out_shape=(rows + 2 * pad, cols + 2 * pad), transform=padded,
                      all_touched=True, dtype="uint8").astype(bool)
        if not m.any():
            return np.full(area.shape, np.inf)
        return (ndimage.distance_transform_edt(~m) * PIXEL_M)[pad:pad + rows, pad:pad + cols]

    # Nearest part of the route decides; a tie goes to the earlier segment, so
    # neighbouring segments never share a pixel.
    d = dist([seg])
    return study & (d < dist(before)) & (d <= dist(after)), seg
