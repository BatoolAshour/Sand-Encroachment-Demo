"""
Offline tests for the satellite pipeline (no internet needed).

    cd python
    python -m unittest discover -s tests -v

Synthetic scenes check the processing rules and the road-distance logic;
the cache tests check the real Sentinel-2 results shipped in data/satellite.
"""

import json
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from satellite import processing, roads                                  # noqa: E402
from satellite.analysis import CACHE_DIR, LOCATIONS_FILE, REPO_ROOT       # noqa: E402
from satellite.providers import BandData, make_area                      # noqa: E402

SAND = {"B02": 0.11, "B03": 0.22, "B04": 0.34, "B08": 0.40, "B11": 0.53, "B12": 0.46}    # orange dune sand
GRAVEL = {"B02": 0.16, "B03": 0.19, "B04": 0.21, "B08": 0.24, "B11": 0.30, "B12": 0.28}  # grey, low saturation
ASPHALT = {"B02": 0.07, "B03": 0.08, "B04": 0.09, "B08": 0.11, "B11": 0.13, "B12": 0.12}
VEG = {"B02": 0.04, "B03": 0.07, "B04": 0.05, "B08": 0.35, "B11": 0.18, "B12": 0.09}


def synthetic(layout, scl=None, area=None):
    """layout: 2-D array of surface names -> BandData with those reflectances."""
    rng = np.random.default_rng(0)
    surfaces = {"sand": SAND, "gravel": GRAVEL, "asphalt": ASPHALT, "veg": VEG}
    bands = {}
    for b in SAND:
        a = np.zeros(layout.shape, "float32")
        for name, refl in surfaces.items():
            a[layout == name] = refl[b]
        bands[b] = a + rng.normal(0, 0.002, layout.shape).astype("float32")
    scl = np.full(layout.shape, 5, "uint8") if scl is None else scl
    return BandData(bands=bands, scl=scl, nodata=np.zeros(layout.shape, bool),
                    area=area or make_area(24.8, 50.7, layout.shape[0] * 10))


class ProcessingTests(unittest.TestCase):
    def test_sand_vs_gravel_vs_vegetation(self):
        layout = np.full((100, 100), "gravel", dtype=object)
        layout[:, :50] = "sand"
        layout[80:, 80:] = "veg"
        masks, diag = processing.detect_sand(synthetic(layout))
        self.assertGreater(masks["sand"][:, :50].mean(), 0.97)
        self.assertLess(masks["sand"][:, 50:].mean(), 0.01)
        self.assertTrue(masks["vegetation"][85:, 85:].all())
        m = processing.measure(masks)
        self.assertAlmostEqual(m["area_sand_coverage_pct"], 50.0, delta=1.5)
        self.assertIsNone(m["distance_to_road_m"])           # no road -> no distance

    def test_clouds_are_excluded_not_counted(self):
        layout = np.full((60, 60), "sand", dtype=object)
        scl = np.full((60, 60), 5, "uint8")
        scl[:30] = 9                                          # high-probability cloud
        masks, _ = processing.detect_sand(synthetic(layout, scl))
        m = processing.measure(masks)
        self.assertEqual(m["valid_pct"], 50.0)
        self.assertEqual(m["cloud_pct"], 50.0)
        self.assertFalse(masks["sand"][:30].any())
        self.assertGreater(m["area_sand_coverage_pct"], 97)  # share of CLEAR pixels

    def test_small_speckle_removed_by_morphology(self):
        layout = np.full((60, 60), "gravel", dtype=object)
        layout[10, 10] = layout[40, 20] = "sand"              # single pixels
        masks, _ = processing.detect_sand(synthetic(layout))
        self.assertFalse(masks["sand"].any())

    def test_road_distance_and_strip(self):
        # 2 km square; vertical road in column 100; sand starts 300 m east of it.
        area = make_area(24.8, 50.7, 2000)
        layout = np.full((200, 200), "gravel", dtype=object)
        layout[:, 100] = "asphalt"
        layout[:, 130:] = "sand"
        data = synthetic(layout, area=area)
        line = roads.pixel_line_to_geojson(area, [(100, 0), (100, 199)])
        dist, reason = roads.road_distance(area, {"type": "LineString", "coordinates": line})
        self.assertIsNone(reason)
        masks, _ = processing.detect_sand(data)
        m = processing.measure(masks, dist, buffer_m=400)
        self.assertEqual(m["distance_to_road_m"], 300)
        # Strip = 400 m each side (81 columns incl. road); sand fills columns 130-140 -> ~13.6 %
        self.assertAlmostEqual(m["sand_coverage_pct"], 100 * 11 / 81, delta=3)

    def test_road_outside_area_is_rejected(self):
        area = make_area(24.8, 50.7, 2000)
        far = {"type": "LineString", "coordinates": [[51.5, 25.5], [51.6, 25.6]]}
        dist, reason = roads.road_distance(area, far)
        self.assertIsNone(dist)
        self.assertIn("does not cross", reason)


class CdseProviderTests(unittest.TestCase):
    """Copernicus Data Space requests and response parsing, with the network mocked."""

    def test_find_and_read(self):
        from unittest import mock

        import rasterio
        from rasterio.io import MemoryFile

        from satellite.providers import CdseProvider, fetch_bands

        area = make_area(24.8, 50.7, 1000)                 # 100 x 100 px
        rows, cols = area.shape
        stack = np.zeros((8, rows, cols), "float32")
        for i, b in enumerate(["B02", "B03", "B04", "B08", "B11", "B12"]):
            stack[i] = SAND[b]
        stack[6] = 5                                        # SCL: bare soil
        stack[7] = 1                                        # dataMask
        with MemoryFile() as mem:
            with mem.open(driver="GTiff", width=cols, height=rows, count=8, dtype="float32",
                          crs=f"EPSG:{area.epsg}", transform=area.transform) as ds:
                ds.write(stack)
            tiff = mem.read()

        calls = []

        def fake_post(url, **kw):
            calls.append((url, kw))
            r = mock.Mock(status_code=200)
            if "token" in url:
                r.json.return_value = {"access_token": "T", "expires_in": 600}
            elif "catalog" in url:
                r.json.return_value = {"features": [
                    {"id": "S2A_far", "properties": {"datetime": "2026-10-01T07:00:00Z", "eo:cloud_cover": 0}},
                    {"id": "S2B_near", "properties": {"datetime": "2026-10-19T07:00:00Z", "eo:cloud_cover": 5}},
                ]}
            else:
                r.content = tiff
            return r

        with mock.patch("satellite.providers.requests.post", side_effect=fake_post):
            scene, data = fetch_bands(CdseProvider("id", "secret"), area, "2026-10-20")
        self.assertEqual(scene.scene_id, "S2B_near")          # nearest date wins
        self.assertEqual(data.bands["B04"].shape, (rows, cols))
        self.assertAlmostEqual(float(data.bands["B04"].mean()), SAND["B04"], places=4)
        self.assertFalse(data.nodata.any())
        process = [kw for url, kw in calls if url.endswith("/process")][0]["json"]
        self.assertEqual(process["input"]["data"][0]["type"], "sentinel-2-l2a")
        self.assertEqual(process["input"]["data"][0]["dataFilter"]["timeRange"]["from"], "2026-10-19T00:00:00Z")
        self.assertEqual(process["output"]["resx"], 10)
        self.assertIn(f"EPSG/0/{area.epsg}", process["input"]["bounds"]["properties"]["crs"])
        self.assertTrue(all(kw["headers"]["Authorization"] == "Bearer T"
                            for url, kw in calls if "token" not in url))


class CacheTests(unittest.TestCase):
    """The shipped real analyses are complete and self-consistent."""

    def test_cached_results(self):
        results = [json.loads(p.read_text()) for p in CACHE_DIR.glob("*/*/result.json")]
        self.assertGreaterEqual(len(results), 3)
        for r in results:
            self.assertEqual(r["data_kind"], "satellite-derived")
            self.assertRegex(r["scene"]["id"], r"^S2[ABC]_\w{5}_\d{8}_\d+_L2A$")
            for img in r["images"].values():
                self.assertTrue((REPO_ROOT / img).exists(), img)
            m = r["measurements"]
            self.assertTrue(0 <= m["area_sand_coverage_pct"] <= 100)
            if r["road"]["available"]:
                self.assertIsNotNone(m["sand_coverage_pct"])
            else:
                self.assertIsNone(m["distance_to_road_m"])

    def test_every_location_has_valid_road(self):
        for loc in json.loads(LOCATIONS_FILE.read_text())["locations"]:
            area = make_area(loc["lat"], loc["lon"], loc["size_m"])
            geom, _ = roads.load_road(REPO_ROOT / "data/satellite/roads" / f"{loc['id']}.geojson")
            self.assertIsNotNone(geom, loc["id"])
            dist, reason = roads.road_distance(area, geom)
            self.assertIsNone(reason, loc["id"])


if __name__ == "__main__":
    unittest.main()
