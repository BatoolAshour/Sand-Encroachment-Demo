"""
providers.py — find a Sentinel-2 L2A scene and read its bands for one area.

Two providers, same interface:

    CdseProvider  Copernicus Data Space Ecosystem (preferred).
                  Catalog API to find the scene, Process API to cut out the
                  area. Needs a free OAuth client:
                      CDSE_CLIENT_ID / CDSE_CLIENT_SECRET (environment variables)
    AwsCogProvider  Public Sentinel-2 L2A archive on AWS Open Data
                  (s3://sentinel-cogs, Element 84). No account needed.
                  Used when no CDSE credentials are set.

Both return bottom-of-atmosphere reflectance (0-1, float32) on the same
10 m grid in UTM, plus the Scene Classification Layer (SCL) for cloud masks.
"""

from __future__ import annotations

import datetime as dt
import os
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

import numpy as np
import requests

try:
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.io import MemoryFile
    from rasterio.vrt import WarpedVRT
    from rasterio.warp import transform as warp_transform
    from rasterio.windows import from_bounds
except ImportError as err:  # pragma: no cover
    raise SystemExit("Missing packages. Run:  pip install -r python/requirements.txt") from err


BANDS = ["B02", "B03", "B04", "B08", "B11", "B12"]   # blue, green, red, NIR, SWIR1, SWIR2
PIXEL_M = 10
HTTP_TIMEOUT = 60

# Optional: a custom CA bundle for corporate proxies (also used by GDAL).
CA_BUNDLE = os.environ.get("REQUESTS_CA_BUNDLE") or os.environ.get("CURL_CA_BUNDLE") or True


class SatelliteError(RuntimeError):
    """A problem the user should see (no scene, no access, bad input…)."""


@dataclass
class Area:
    """A rectangular area of interest, snapped to the 10 m grid of its UTM zone."""
    lat: float
    lon: float
    size_m: int
    epsg: int
    bounds: tuple            # (minx, miny, maxx, maxy) in metres, EPSG:<epsg>

    @property
    def width_m(self):
        return int(round(self.bounds[2] - self.bounds[0]))

    @property
    def height_m(self):
        return int(round(self.bounds[3] - self.bounds[1]))

    @property
    def shape(self):
        minx, miny, maxx, maxy = self.bounds
        return int(round((maxy - miny) / PIXEL_M)), int(round((maxx - minx) / PIXEL_M))

    @property
    def transform(self):
        return rasterio.transform.from_origin(self.bounds[0], self.bounds[3], PIXEL_M, PIXEL_M)

    def wgs84_bounds(self):
        minx, miny, maxx, maxy = self.bounds
        xs, ys = warp_transform(f"EPSG:{self.epsg}", "EPSG:4326",
                                [minx, maxx, minx, maxx], [miny, miny, maxy, maxy])
        return min(xs), min(ys), max(xs), max(ys)


def make_area(lat, lon, size_m=5000, epsg=None):
    if not (-80 <= lat <= 84 and -180 <= lon <= 180):
        raise SatelliteError("Coordinates are outside the Sentinel-2 / UTM range.")
    if epsg is None:
        zone = int((lon + 180) // 6) + 1
        epsg = (32600 if lat >= 0 else 32700) + zone
    xs, ys = warp_transform("EPSG:4326", f"EPSG:{epsg}", [lon], [lat])
    half = size_m / 2
    snap = lambda v: round(v / PIXEL_M) * PIXEL_M
    bounds = (snap(xs[0] - half), snap(ys[0] - half), snap(xs[0] + half), snap(ys[0] + half))
    return Area(lat=lat, lon=lon, size_m=size_m, epsg=epsg, bounds=bounds)


def area_from_bounds(lat, lon, epsg, bounds):
    """Area from UTM bounds (a route segment's image, see routes.build_segments)."""
    minx, miny, maxx, maxy = bounds
    if any(v % PIXEL_M for v in bounds) or maxx <= minx or maxy <= miny:
        raise SatelliteError("Segment bounds are not on the 10 m grid; re-run python import_routes.py.")
    if epsg != (32600 if lat >= 0 else 32700) + int((lon + 180) // 6) + 1:
        raise SatelliteError("Segment UTM zone does not match its centre; re-run python import_routes.py.")
    return Area(lat=lat, lon=lon, size_m=int(max(maxx - minx, maxy - miny)), epsg=epsg, bounds=tuple(bounds))


@dataclass
class Scene:
    scene_id: str
    date: str                       # YYYY-MM-DD (acquisition, UTC)
    datetime: str
    tile_cloud_pct: float | None
    provider: str
    extra: dict = field(default_factory=dict)


@dataclass
class BandData:
    """Reflectance (0-1) per band, SCL classes and a valid-data mask, all (rows, cols)."""
    bands: dict
    scl: np.ndarray
    nodata: np.ndarray
    area: Area


def _parse_date(text):
    try:
        return dt.date.fromisoformat(text)
    except (TypeError, ValueError):
        raise SatelliteError(f"Invalid date '{text}'. Use YYYY-MM-DD.") from None


# ---------------------------------------------------------------------------
# Copernicus Data Space Ecosystem (Sentinel Hub APIs on CDSE)
# ---------------------------------------------------------------------------
class CdseProvider:
    name = "Copernicus Data Space Ecosystem"
    TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"
    CATALOG_URL = "https://sh.dataspace.copernicus.eu/api/v1/catalog/1.0.0/search"
    PROCESS_URL = "https://sh.dataspace.copernicus.eu/api/v1/process"

    EVALSCRIPT = """//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B02","B03","B04","B08","B11","B12","SCL","dataMask"] }],
    output: { bands: 8, sampleType: "FLOAT32" }
  };
}
function evaluatePixel(s) {
  return [s.B02, s.B03, s.B04, s.B08, s.B11, s.B12, s.SCL, s.dataMask];
}"""

    def __init__(self, client_id, client_secret):
        self.client_id = client_id
        self.client_secret = client_secret
        self._token = None
        self._token_expires = 0.0

    @classmethod
    def from_env(cls):
        cid, secret = os.environ.get("CDSE_CLIENT_ID"), os.environ.get("CDSE_CLIENT_SECRET")
        return cls(cid, secret) if cid and secret else None

    def _auth(self):
        now = dt.datetime.now().timestamp()
        if self._token and now < self._token_expires - 60:
            return {"Authorization": f"Bearer {self._token}"}
        r = requests.post(self.TOKEN_URL, timeout=HTTP_TIMEOUT, verify=CA_BUNDLE, data={
            "grant_type": "client_credentials",
            "client_id": self.client_id,
            "client_secret": self.client_secret,
        })
        if r.status_code != 200:
            raise SatelliteError(f"CDSE login failed ({r.status_code}). Check CDSE_CLIENT_ID / CDSE_CLIENT_SECRET.")
        body = r.json()
        self._token = body["access_token"]
        self._token_expires = now + float(body.get("expires_in", 600))
        return {"Authorization": f"Bearer {self._token}"}

    def find_scene(self, area, date, max_days=15, max_cloud=30):
        day = _parse_date(date)
        start, end = day - dt.timedelta(days=max_days), day + dt.timedelta(days=max_days)
        r = requests.post(self.CATALOG_URL, headers=self._auth(), timeout=HTTP_TIMEOUT, verify=CA_BUNDLE, json={
            "bbox": list(area.wgs84_bounds()),
            "datetime": f"{start}T00:00:00Z/{end}T23:59:59Z",
            "collections": ["sentinel-2-l2a"],
            "limit": 100,
            "filter": f"eo:cloud_cover <= {max_cloud}",
            "filter-lang": "cql2-text",
        })
        if r.status_code != 200:
            raise SatelliteError(f"CDSE catalog search failed ({r.status_code}): {r.text[:200]}")
        scenes = []
        for f in r.json().get("features", []):
            when = f["properties"]["datetime"]
            scenes.append(Scene(scene_id=f["id"], date=when[:10], datetime=when,
                                tile_cloud_pct=f["properties"].get("eo:cloud_cover"), provider=self.name))
        return _rank(scenes, day)

    def read(self, scene, area):
        start = f"{scene.date}T00:00:00Z"
        end = f"{scene.date}T23:59:59Z"
        minx, miny, maxx, maxy = area.bounds
        r = requests.post(self.PROCESS_URL, headers=self._auth(), timeout=HTTP_TIMEOUT * 2, verify=CA_BUNDLE, json={
            "input": {
                "bounds": {"bbox": [minx, miny, maxx, maxy],
                           "properties": {"crs": f"http://www.opengis.net/def/crs/EPSG/0/{area.epsg}"}},
                "data": [{"type": "sentinel-2-l2a",
                          "dataFilter": {"timeRange": {"from": start, "to": end}, "mosaickingOrder": "leastCC"}}],
            },
            "output": {"resx": PIXEL_M, "resy": PIXEL_M,
                       "responses": [{"identifier": "default", "format": {"type": "image/tiff"}}]},
            "evalscript": self.EVALSCRIPT,
        })
        if r.status_code != 200:
            raise SatelliteError(f"CDSE process request failed ({r.status_code}): {r.text[:200]}")
        with MemoryFile(r.content) as mem, mem.open() as ds:
            a = ds.read(out_shape=(8, *area.shape)).astype("float32")
        bands = {b: a[i] for i, b in enumerate(BANDS)}
        return BandData(bands=bands, scl=a[6].astype("uint8"), nodata=a[7] < 0.5, area=area)


# ---------------------------------------------------------------------------
# AWS Open Data: Sentinel-2 L2A Cloud-Optimised GeoTIFFs (no account needed)
# ---------------------------------------------------------------------------
class AwsCogProvider:
    name = "AWS Open Data (Sentinel-2 L2A COGs, Element 84)"
    BUCKET = "https://sentinel-cogs.s3.us-west-2.amazonaws.com"
    PREFIX = "sentinel-s2-l2a-cogs"
    ASSETS = {"B02": "blue", "B03": "green", "B04": "red", "B08": "nir",
              "B11": "swir16", "B12": "swir22", "SCL": "scl"}

    def find_scene(self, area, date, max_days=15, max_cloud=30):
        day = _parse_date(date)
        months = {(d.year, d.month) for d in (day - dt.timedelta(days=max_days), day, day + dt.timedelta(days=max_days))}
        # The tile of the centre first. Near a UTM zone edge that MGRS square may not be a
        # Sentinel-2 tile (e.g. 39RSH); then the tile of a corner is used, and read()
        # fills the rest of the area from the neighbouring tiles.
        ids, tile = [], None
        for candidate in _area_tiles(area):
            for year, month in sorted(months):
                ids += self._list(f"{self.PREFIX}/{int(candidate[:2])}/{candidate[2]}/{candidate[3:]}/{year}/{month}/")
            if ids:
                tile = candidate
                break
        scenes = []
        for item_id in ids:
            m = re.match(r"S2[ABC]_\w{5}_(\d{8})_\d+_L2A$", item_id)
            if not m:
                continue
            when = dt.datetime.strptime(m.group(1), "%Y%m%d").date()
            if abs((when - day).days) > max_days:
                continue
            scenes.append(Scene(scene_id=item_id, date=when.isoformat(), datetime="",
                                tile_cloud_pct=None, provider=self.name, extra={"tile": tile}))
        # Nearest dates first; read the STAC item only for those we may use.
        ranked = []
        for s in sorted(scenes, key=lambda s: abs((_parse_date(s.date) - day).days)):
            item = self._item(s)
            props = item.get("properties", {})
            s.tile_cloud_pct = props.get("eo:cloud_cover")
            s.datetime = props.get("datetime", "")
            s.extra["item"] = item
            if s.tile_cloud_pct is None or s.tile_cloud_pct <= max_cloud:
                ranked.append(s)
            if len(ranked) >= 6:
                break
        return _rank(ranked, day)

    def _list(self, prefix):
        r = requests.get(self.BUCKET, timeout=HTTP_TIMEOUT, verify=CA_BUNDLE,
                         params={"list-type": "2", "prefix": prefix, "delimiter": "/"})
        if r.status_code != 200:
            raise SatelliteError(f"AWS Sentinel-2 archive not reachable ({r.status_code}).")
        ns = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}
        root = ET.fromstring(r.content)
        return [p.text.rstrip("/").split("/")[-1] for p in root.findall("s3:CommonPrefixes/s3:Prefix", ns)]

    def _item(self, scene):
        t = scene.extra["tile"]
        d = _parse_date(scene.date)
        url = f"{self.BUCKET}/{self.PREFIX}/{int(t[:2])}/{t[2]}/{t[3:]}/{d.year}/{d.month}/{scene.scene_id}/{scene.scene_id}.json"
        r = requests.get(url, timeout=HTTP_TIMEOUT, verify=CA_BUNDLE)
        if r.status_code != 200:
            raise SatelliteError(f"Scene metadata not found for {scene.scene_id}.")
        return r.json()

    def _read_item(self, item, area):
        """Bands of one tile, cut to the area (reprojected when the tile is in another UTM zone)."""
        rows, cols = area.shape
        out, scl = {}, None
        env = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MAX_RETRY="3", GDAL_HTTP_RETRY_DELAY="2")
        if isinstance(CA_BUNDLE, str):
            env["CURL_CA_BUNDLE"] = CA_BUNDLE
        with rasterio.Env(**env):
            for band, key in self.ASSETS.items():
                asset = item["assets"][key]
                resampling = Resampling.nearest if band == "SCL" else Resampling.bilinear
                with rasterio.open("/vsicurl/" + asset["href"]) as ds:
                    if ds.crs.to_epsg() == area.epsg:
                        win = from_bounds(*area.bounds, transform=ds.transform)
                        a = ds.read(1, window=win, out_shape=(rows, cols), boundless=True, fill_value=0,
                                    resampling=resampling)
                    else:
                        # Tile in the neighbouring UTM zone: warp it onto the area's 10 m grid.
                        with WarpedVRT(ds, crs=f"EPSG:{area.epsg}", transform=area.transform, width=cols,
                                       height=rows, resampling=resampling, nodata=0) as vrt:
                            a = vrt.read(1)
                if band == "SCL":
                    scl = a.astype("uint8")
                    continue
                rb = (asset.get("raster:bands") or [{}])[0]
                scale, offset = rb.get("scale", 0.0001), rb.get("offset", 0.0)
                refl = a.astype("float32") * scale + offset
                refl[a == 0] = np.nan
                out[band] = refl
        return out, scl

    def _same_pass_items(self, scene, area):
        """Items of the same date on the neighbouring tiles that the area reaches into."""
        d = _parse_date(scene.date)
        items = []
        for t in _area_tiles(area):
            if t == scene.extra["tile"]:
                continue
            for item_id in self._list(f"{self.PREFIX}/{int(t[:2])}/{t[2]}/{t[3:]}/{d.year}/{d.month}/"):
                if re.match(rf"S2[ABC]_{t}_{d:%Y%m%d}_\d+_L2A$", item_id):
                    items.append(self._item(Scene(item_id, scene.date, "", None, self.name, {"tile": t})))
        return items

    def read(self, scene, area):
        item = scene.extra.get("item") or self._item(scene)
        out, scl = self._read_item(item, area)
        nodata = (scl == 0) | np.isnan(out["B04"])
        if nodata.any():
            # The area reaches beyond this tile: fill the gap from the same pass on the neighbours.
            for other in self._same_pass_items(scene, area):
                more, more_scl = self._read_item(other, area)
                fill = nodata & (more_scl != 0) & ~np.isnan(more["B04"])
                for b in out:
                    out[b][fill] = more[b][fill]
                scl[fill] = more_scl[fill]
                nodata &= ~fill
                scene.extra.setdefault("mosaic_tiles", []).append(other["id"])
                if not nodata.any():
                    break
        return BandData(bands=out, scl=scl, nodata=nodata, area=area)


def _mgrs_tile(lat, lon):
    try:
        import mgrs
    except ImportError:
        raise SystemExit("Missing package 'mgrs'. Run:  pip install -r python/requirements.txt") from None
    return mgrs.MGRS().toMGRS(lat, lon, MGRSPrecision=0)


def _area_tiles(area):
    """MGRS tiles under the area: the centre's first, then the corners' and edges'."""
    w, s, e, n = area.wgs84_bounds()
    points = [(area.lat, area.lon)] + [(la, lo) for la in (s, area.lat, n) for lo in (w, area.lon, e)]
    return list(dict.fromkeys(_mgrs_tile(la, lo) for la, lo in points))


def _rank(scenes, day):
    """Nearest date first, then the clearest tile."""
    return sorted(scenes, key=lambda s: (abs((_parse_date(s.date) - day).days),
                                         s.tile_cloud_pct if s.tile_cloud_pct is not None else 100))


def get_provider(preference="auto"):
    """'cdse' | 'aws' | 'auto' (CDSE when credentials are set, otherwise AWS)."""
    cdse = CdseProvider.from_env()
    if preference == "cdse":
        if not cdse:
            raise SatelliteError("CDSE selected but CDSE_CLIENT_ID / CDSE_CLIENT_SECRET are not set.")
        return cdse
    if preference == "aws":
        return AwsCogProvider()
    return cdse or AwsCogProvider()


def fetch_bands(provider, area, date, max_days=15, max_cloud=30, min_valid=0.9, region=None):
    """Nearest usable scene to `date`: tries candidates until the area (or `region`, a mask of
    the pixels that will be measured) has enough pixels with data."""
    candidates = provider.find_scene(area, date, max_days=max_days, max_cloud=max_cloud)
    if not candidates:
        raise SatelliteError(f"No Sentinel-2 scene with ≤{max_cloud}% cloud within ±{max_days} days of {date}.")
    reasons = []
    for scene in candidates[:4]:
        data = provider.read(scene, area)
        valid = 1.0 - float(np.mean(data.nodata if region is None else data.nodata[region]))
        if valid >= min_valid:
            return scene, data
        reasons.append(f"{scene.scene_id}: only {valid:.0%} of the area has data")
    raise SatelliteError("No complete scene for this area. " + "; ".join(reasons))
