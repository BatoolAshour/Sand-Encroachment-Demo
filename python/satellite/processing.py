"""
processing.py — sand detection on one Sentinel-2 L2A area (10 m pixels).

Pipeline (each step is a plain, explainable rule, not a trained model):

  1. Valid pixels   Scene Classification Layer (SCL): drop no-data, saturated,
                    cloud, cloud shadow, cirrus and water pixels.
  2. Colour         true-colour RGB -> HSV. Aeolian sand in Arabia is
     segmentation   yellow-orange to red (iron-oxide coating), so it must fall
                    in the hue range below and be clearly coloured
                    (saturation threshold).
  3. Thresholding   spectral indices: Bare Soil Index (BSI) must be positive
                    and NDVI low (no vegetation); brightness above the dark
                    surfaces (asphalt, shadow). The saturation threshold is
                    chosen per image with Otsu's method, kept inside safe bounds.
  4. Texture        local standard deviation of red reflectance in a 5x5
                    window (50 m). Loose sand sheets and dunes are smooth at
                    this scale; rock, settlements and road works are rough.
                    Sand pixels next to smooth sand keep their label (the
                    window straddles the boundary there).
  5. Morphology     opening (remove speckle), closing (fill gaps), removal of
                    patches smaller than MIN_PATCH_PX and of small holes.

Outputs are masks plus the measurements in measure(). All percentages are
shares of VALID pixels, so clouds never count as sand or as "no sand".
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage

# --- Tunable rules (documented in README section "Sand detection") -------
SCL_EXCLUDE = {0: "no data", 1: "saturated", 3: "cloud shadow", 6: "water",
               8: "cloud (medium)", 9: "cloud (high)", 10: "cirrus"}
SCL_CLOUD = (3, 8, 9, 10)

SAND_HUE_DEG = (8.0, 48.0)       # yellow-orange-red
SAT_BOUNDS = (0.45, 0.65)        # Otsu threshold is clipped into this range
MIN_BRIGHTNESS = 0.15            # mean visible reflectance; asphalt/shadow are darker
MIN_BSI = 0.0                    # bare-soil index
MAX_NDVI_SAND = 0.15
VEGETATION_NDVI = 0.25
TEXTURE_WINDOW = 5               # pixels (5 x 10 m = 50 m)
MAX_TEXTURE = 0.015              # reflectance std-dev; above = rough surface
MIN_PATCH_PX = 25                # 25 px = 0.25 ha
DISPLAY_GAIN_PERCENTILE = 99.5


def _ratio(a, b):
    with np.errstate(divide="ignore", invalid="ignore"):
        r = a / b
    return np.where(np.isfinite(r), r, 0.0)


def true_colour(bands, valid=None):
    """Display RGB (0-1) with one common stretch, so colours keep their real ratios."""
    rgb = np.dstack([bands["B04"], bands["B03"], bands["B02"]]).astype("float32")
    rgb = np.nan_to_num(rgb, nan=0.0)
    sample = rgb[valid] if valid is not None and valid.any() else rgb.reshape(-1, 3)
    hi = max(float(np.percentile(sample, DISPLAY_GAIN_PERCENTILE)), 0.05)
    return np.clip(rgb / hi, 0, 1) ** (1 / 1.25)


def rgb_to_hsv(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx, mn = rgb.max(axis=-1), rgb.min(axis=-1)
    delta = mx - mn
    hue = np.zeros_like(mx)
    m = delta > 1e-6
    rm = m & (mx == r)
    gm = m & (mx == g) & ~rm
    bm = m & ~rm & ~gm
    hue[rm] = ((g[rm] - b[rm]) / delta[rm]) % 6
    hue[gm] = (b[gm] - r[gm]) / delta[gm] + 2
    hue[bm] = (r[bm] - g[bm]) / delta[bm] + 4
    sat = _ratio(delta, mx)
    return hue * 60.0, sat, mx


def otsu(values, bins=128):
    """Otsu's threshold for a 1-D sample."""
    values = values[np.isfinite(values)]
    if values.size < 50:
        return None
    hist, edges = np.histogram(values, bins=bins)
    centres = (edges[:-1] + edges[1:]) / 2
    w0 = np.cumsum(hist)
    w1 = w0[-1] - w0
    m0 = np.cumsum(hist * centres)
    mu0 = _ratio(m0, w0)
    mu1 = _ratio(m0[-1] - m0, w1)
    between = w0 * w1 * (mu0 - mu1) ** 2
    return float(centres[int(np.argmax(between[:-1]))])


def local_std(img, size=TEXTURE_WINDOW):
    mean = ndimage.uniform_filter(img, size)
    mean_sq = ndimage.uniform_filter(img * img, size)
    return np.sqrt(np.clip(mean_sq - mean * mean, 0, None))


def remove_small(mask, min_px):
    labels, n = ndimage.label(mask)
    if n == 0:
        return mask
    sizes = ndimage.sum(mask, labels, index=np.arange(1, n + 1))
    keep = np.zeros(n + 1, bool)
    keep[1:] = sizes >= min_px
    return keep[labels]


def detect_sand(band_data):
    """Returns (masks, diagnostics). Masks are boolean arrays of the area's shape."""
    b = {k: np.nan_to_num(v, nan=0.0) for k, v in band_data.bands.items()}
    scl = band_data.scl

    # 1. Valid pixels
    valid = ~band_data.nodata & ~np.isin(scl, list(SCL_EXCLUDE))
    cloud = np.isin(scl, SCL_CLOUD) & ~band_data.nodata

    # 2. Colour segmentation
    rgb = np.clip(np.dstack([b["B04"], b["B03"], b["B02"]]), 0, 1)
    hue, sat, _ = rgb_to_hsv(rgb)
    brightness = (b["B02"] + b["B03"] + b["B04"]) / 3
    hue_ok = (hue >= SAND_HUE_DEG[0]) & (hue <= SAND_HUE_DEG[1])

    # 3. Thresholding (indices + Otsu on saturation)
    ndvi = _ratio(b["B08"] - b["B04"], b["B08"] + b["B04"])
    bsi = _ratio((b["B11"] + b["B04"]) - (b["B08"] + b["B02"]), (b["B11"] + b["B04"]) + (b["B08"] + b["B02"]))
    vegetation = valid & (ndvi >= VEGETATION_NDVI)
    bare = valid & (bsi > MIN_BSI) & (ndvi < MAX_NDVI_SAND) & (brightness >= MIN_BRIGHTNESS)
    otsu_sat = otsu(sat[bare & hue_ok])
    sat_thr = float(np.clip(otsu_sat if otsu_sat is not None else SAT_BOUNDS[0], *SAT_BOUNDS))
    colour = hue_ok & (sat >= sat_thr)

    # 4. Texture
    texture = local_std(b["B04"].astype("float32"))
    smooth = texture <= MAX_TEXTURE

    spectral = bare & colour
    # The 5x5 window also "sees" the neighbouring surface, so sand pixels right
    # at a boundary look rough. Give back those spectral-sand pixels within the
    # window radius of smooth sand (they are only rejected because of the edge).
    smooth_sand = spectral & smooth
    edge_band = ndimage.binary_dilation(smooth_sand, iterations=TEXTURE_WINDOW // 2)
    candidate = smooth_sand | (spectral & edge_band)

    # 5. Morphology
    # (padded with edge values so the image border is not eroded away)
    s = ndimage.generate_binary_structure(2, 1)
    pad = 4
    sand = np.pad(candidate, pad, mode="edge")
    sand = ndimage.binary_opening(sand, structure=s)
    sand = ndimage.binary_closing(sand, structure=s, iterations=2)[pad:-pad, pad:-pad]
    sand = remove_small(sand, MIN_PATCH_PX)
    sand = sand | (valid & ~remove_small(~sand, MIN_PATCH_PX))   # fill small holes
    sand &= valid & ~vegetation

    other_bare = bare & ~sand
    diagnostics = {
        "saturation_threshold": round(sat_thr, 3),
        "saturation_threshold_method": "Otsu" if otsu_sat is not None else "fallback (too few bare pixels)",
        "candidate_pixels": int(candidate.sum()),
        "after_morphology_pixels": int(sand.sum()),
        "texture_rejected_pixels": int((spectral & ~candidate).sum()),
    }
    masks = {"valid": valid, "cloud": cloud, "sand": sand, "vegetation": vegetation,
             "other_bare": other_bare, "rgb": true_colour(band_data.bands, valid)}
    return masks, diagnostics


def _pct(part, whole):
    n = int(whole.sum())
    return round(100.0 * int((part & whole).sum()) / n, 1) if n else None


def measure(masks, road_distance_m=None, buffer_m=200, pixel_m=10, region=None):
    """Coverage for the analysis area and, when a road is known, for the strip beside it.

    region: optional mask of the pixels to measure (a route segment's part of the
    2 km study area). Without it the whole image is the analysis area.
    """
    valid, sand = masks["valid"], masks["sand"]
    total = valid.size
    if region is None:
        region = np.ones_like(valid)
    area_valid = valid & region
    out = {
        "area_km2": round(int(region.sum()) * pixel_m * pixel_m / 1e6, 2),
        "image_km2": round(total * pixel_m * pixel_m / 1e6, 2),
        "valid_pct": _pct(valid, region),
        "cloud_pct": _pct(masks["cloud"], region),
        "area_sand_coverage_pct": _pct(sand, area_valid),
        "area_vegetation_pct": _pct(masks["vegetation"], area_valid),
        "area_other_bare_pct": _pct(masks["other_bare"], area_valid),
        "buffer_m": None,
        "sand_coverage_pct": None,
        "vegetation_coverage_pct": None,
        "bare_soil_pct": None,
        "distance_to_road_m": None,
    }
    if road_distance_m is None:
        return out

    strip = area_valid & (road_distance_m <= buffer_m)
    out.update({
        "buffer_m": buffer_m,
        "strip_valid_pixels": int(strip.sum()),
        "sand_coverage_pct": _pct(sand, strip),
        "vegetation_coverage_pct": _pct(masks["vegetation"], strip),
        "bare_soil_pct": _pct(masks["other_bare"], strip),
    })
    sand_d = road_distance_m[sand & area_valid]
    if sand_d.size:
        # Distance from the road centreline to the nearest detected sand pixel
        # (pixel-centre accuracy, so it is rounded to whole 10 m steps).
        out["distance_to_road_m"] = int(round(float(sand_d.min()) / pixel_m) * pixel_m)
        out["sand_within_20m_of_centreline_px"] = int((sand_d <= 20).sum())
    else:
        out["distance_to_road_m_reason"] = "no sand detected in the analysed area"
    return out
