"""
Offline tests for python/weather_cache.py (Open-Meteo is mocked, no internet).

    cd python
    python -m unittest discover -s tests -v
"""

import datetime as dt
import io
import json
import sys
import tempfile
import unittest
import urllib.error
import urllib.parse
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import weather_cache as W                                               # noqa: E402


def answer(lat, lon, date, values=True):
    """An Open-Meteo-shaped answer (structure only; values are test numbers)."""
    hours = [f"{date}T{h:02d}:00" for h in range(24)]
    v = (lambda x: [x] * 24) if values else (lambda x: [None] * 24)
    return {
        "latitude": round(lat, 2), "longitude": round(lon, 2), "elevation": 150.0,
        "hourly_units": {"wind_speed_10m": "m/s"},
        "hourly": {"time": hours, "temperature_2m": v(30.0), "relative_humidity_2m": v(20),
                   "precipitation": v(0.0), "wind_speed_10m": v(5.0), "wind_direction_10m": v(330),
                   "wind_gusts_10m": v(9.0)},
        "daily": {"time": [date]},
    }


class FakeOpenMeteo:
    """Stands in for urllib.request.urlopen; records every URL."""

    def __init__(self, archive_has_values=True, fail=None):
        self.urls, self.archive_has_values, self.fail = [], archive_has_values, fail

    def __call__(self, url, timeout=None):
        self.urls.append(url)
        if self.fail:
            raise self.fail
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
        lat, lon, date = float(q["latitude"][0]), float(q["longitude"][0]), q["start_date"][0]
        values = self.archive_has_values or "archive" not in url
        return io.BytesIO(json.dumps(answer(lat, lon, date, values)).encode())


class WeatherCacheTests(unittest.TestCase):
    def setUp(self):
        self.routes = W.load_routes()
        self.route = self.routes[0]
        self.seg = self.route["segments"][0]
        self.today = W.today()

    def past(self, days):
        return (self.today - dt.timedelta(days=days)).isoformat()

    def test_request_uses_segment_centre_and_units(self):
        lon, lat = self.seg["center"]
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(W.request_url(lat, lon, "2026-10-20", "archive")).query)
        self.assertEqual(q["latitude"][0], f"{lat:.5f}")
        self.assertEqual(q["longitude"][0], f"{lon:.5f}")
        self.assertEqual(q["wind_speed_unit"][0], "ms")
        self.assertEqual(q["timezone"][0], "Asia/Riyadh")
        for var in ("wind_speed_10m", "wind_direction_10m", "wind_gusts_10m", "temperature_2m",
                    "relative_humidity_2m", "precipitation"):
            self.assertIn(var, q["hourly"][0].split(","))

    def test_old_dates_use_the_archive(self):
        fake = FakeOpenMeteo()
        with mock.patch("urllib.request.urlopen", fake):
            rec = W.fetch_record(self.route["id"], self.seg, self.past(30))
        self.assertEqual(rec["api"], "archive")
        self.assertTrue(fake.urls[0].startswith(W.ARCHIVE_URL))
        self.assertEqual(rec["key"], f"{self.seg['id']}|{self.past(30)}")
        self.assertEqual(rec["kind"], "historical")

    def test_recent_dates_use_the_forecast_analysis(self):
        fake = FakeOpenMeteo()
        with mock.patch("urllib.request.urlopen", fake):
            rec = W.fetch_record(self.route["id"], self.seg, self.past(2))
        self.assertEqual(rec["api"], "forecast")
        self.assertEqual(len(fake.urls), 1)

    def test_empty_archive_falls_back_to_forecast(self):
        fake = FakeOpenMeteo(archive_has_values=False)
        with mock.patch("urllib.request.urlopen", fake):
            rec = W.fetch_record(self.route["id"], self.seg, self.past(7))
        self.assertEqual(rec["api"], "forecast")
        self.assertEqual(len(fake.urls), 2)

    def test_today_and_future_are_refused(self):
        with mock.patch("urllib.request.urlopen", FakeOpenMeteo()) as _:
            for date in (self.today.isoformat(), self.past(-1)):
                with self.assertRaises(W.WeatherError):
                    W.fetch_record(self.route["id"], self.seg, date)

    def test_network_errors_are_reported(self):
        fail = urllib.error.URLError("blocked")
        with mock.patch("urllib.request.urlopen", FakeOpenMeteo(fail=fail)):
            with self.assertRaisesRegex(W.WeatherError, "not reachable"):
                W.fetch_record(self.route["id"], self.seg, self.past(30))

    def test_answer_for_another_place_is_rejected(self):
        lon, lat = self.seg["center"]
        with self.assertRaises(W.WeatherError):
            W.check_response(answer(lat + 2, lon, "2026-10-20"), lat, lon)

    def test_default_targets_are_the_cached_satellite_images(self):
        todo = W.targets(self.routes)
        self.assertEqual(len(todo), len(W.satellite_targets()))
        for route_id, seg, date in todo:
            self.assertTrue(seg["id"].startswith(route_id))

    def test_cache_file_round_trip(self):
        fake = FakeOpenMeteo()
        with mock.patch("urllib.request.urlopen", fake):
            rec = W.fetch_record(self.route["id"], self.seg, self.past(30))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "weather_cache.js"
            W.write_cache({rec["key"]: rec}, path)
            self.assertIn("const WEATHER_CACHE = ", path.read_text(encoding="utf-8"))
            self.assertEqual(W.read_cache(path), {rec["key"]: rec})


if __name__ == "__main__":
    unittest.main()
