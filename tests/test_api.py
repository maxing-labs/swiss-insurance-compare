"""Offline tests for api/index.py.

Parsers run on trimmed real upstream pages (tests/fixtures/, see tests/make_fixtures.py).
HTTP tests start both handlers on localhost with api.fetch_upstream replaced by the fixtures.
"""
import http.client
import json
import threading
import unittest
import urllib.parse
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock

import api.index as api
import server

FIXTURES = Path(__file__).parent / "fixtures"
INSURERS = {"KPT", "ÖKK", "Einsiedeln"}  # rows kept by tests/make_fixtures.py
PLAN_COUNT = 12
# the inline CSS braces once made /api/locations parse the page as JSON and return 500
MAINTENANCE = (
    "<html><head><style>body{font-family:sans-serif}</style></head>"
    "<body><h1>Wartungsarbeiten</h1><p>Bitte versuchen Sie es später.</p></body></html>"
)


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def fake_upstream(broken: str = None):
    """Stand-in for api.fetch_upstream. Paths containing `broken` get a maintenance page."""

    def fetch(path):
        if broken and broken in path:
            return MAINTENANCE
        if path.startswith("/de/praemien/locations"):
            return fixture("locations.js")
        if path.startswith("/de/praemien/franchises"):
            return fixture("franchises.html")
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(path).query)
        if qs["models[]"] == ["PHARM"]:
            return fixture("no_premiums.html")
        return fixture(f"{qs['display'][0]}.html")

    return fetch


class ParserTest(unittest.TestCase):
    def test_savings(self):
        plans = api.parse_savings_html(fixture("savings.html"))
        self.assertEqual(len(plans), PLAN_COUNT)
        self.assertEqual({p["insurer"] for p in plans}, INSURERS)
        for p in plans:
            with self.subTest(insurer=p["insurer"], model=p["model"]):
                self.assertTrue(p["insurerUrl"].startswith("http"))
                self.assertNotIn("­", p["model"])
                self.assertGreater(p["monthlyRebate"], 0)
                self.assertAlmostEqual(p["monthlyNet"], p["monthlyGross"] - p["monthlyRebate"], places=2)
                self.assertAlmostEqual(p["yearlyGross"], p["monthlyGross"] * 12, places=2)
                self.assertAlmostEqual(p["yearlyRebate"], p["monthlyRebate"] * 12, places=2)
                self.assertAlmostEqual(p["yearlyNet"], p["yearlyGross"] - p["yearlyRebate"], places=2)

    def test_comparison(self):
        data = api.parse_comparison_html(fixture("comparison.html"))
        self.assertEqual(data["franchises"], [300, 500, 1000, 1500, 2000, 2500])
        self.assertEqual(len(data["rows"]), PLAN_COUNT)
        for r in data["rows"]:
            with self.subTest(insurer=r["insurer"], model=r["model"]):
                prices = [p for p in r["prices"].values() if p is not None]
                self.assertEqual(prices, sorted(prices, reverse=True))
        # upstream shows "—" where an insurer offers no premium for a franchise
        kpt = next(r for r in data["rows"] if r["insurer"] == "KPT")
        self.assertIsNone(kpt["prices"]["2000"])

    def test_change(self):
        data = api.parse_change_html(fixture("change.html"))
        self.assertEqual(data["years"], ["2022", "2023", "2024", "2025", "2026", "2027"])
        self.assertEqual({r["insurer"] for r in data["rows"]}, INSURERS)
        for r in data["rows"]:
            with self.subTest(insurer=r["insurer"]):
                self.assertIsNotNone(r["avgIncreasePct"])
                history = [r["history"][y] for y in data["years"]]
                self.assertIsNone(history[0]["changePct"])
                for prev, cur in zip(history, history[1:]):
                    expected = (cur["premium"] / prev["premium"] - 1) * 100
                    self.assertAlmostEqual(cur["changePct"], expected, delta=0.05)

    def test_franchises(self):
        options = api.parse_select_options(fixture("franchises.html"))
        self.assertEqual([o["value"] for o in options], ["300", "500", "1000", "1500", "2000", "2500"])
        self.assertEqual(options[2]["label"], "CHF 1'000")

    def test_locations(self):
        with mock.patch.object(api, "fetch_upstream", fake_upstream()):
            data = api.get_locations_json()
        self.assertEqual(data["names"]["80011450512497"], "8001 Zürich")
        self.assertEqual(data["index"]["zürich"], ["80011450512497"])

    def test_no_premiums_page(self):
        self.assertEqual(api.parse_savings_html(fixture("no_premiums.html")), [])


class VercelHandlerTest(unittest.TestCase):
    handler_cls = api.handler
    success_cache_control = "s-maxage=3600, stale-while-revalidate"

    @classmethod
    def setUpClass(cls):
        quiet = type("QuietHandler", (cls.handler_cls,), {"log_message": lambda self, *args: None})
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), quiet)
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()
        cls.addClassCleanup(cls.httpd.server_close)
        cls.addClassCleanup(cls.httpd.shutdown)

    def get(self, path, broken=None):
        with mock.patch.object(api, "fetch_upstream", fake_upstream(broken)):
            conn = http.client.HTTPConnection("127.0.0.1", self.httpd.server_port, timeout=10)
            try:
                conn.request("GET", path)
                resp = conn.getresponse()
                return resp.status, resp.getheader("Cache-Control"), json.loads(resp.read())
            finally:
                conn.close()

    def test_calculate(self):
        status, cache_control, body = self.get("/api/calculate")
        self.assertEqual(status, 200)
        self.assertEqual(cache_control, self.success_cache_control)
        meta = body["meta"]
        self.assertEqual(meta["franchises"], [300, 500, 1000, 1500, 2000, 2500])
        self.assertEqual(meta["historyYears"][-1], str(meta["premiumYear"]))
        self.assertEqual(len(body["plans"]), PLAN_COUNT)
        for p in body["plans"]:
            with self.subTest(insurer=p["insurer"], model=p["model"]):
                # fixtures were fetched with franchise 2500: the matrix price must match the savings row
                self.assertEqual(p["matrixPrices"]["2500"], p["monthlyGross"])
                self.assertEqual(list(p["history"]), meta["historyYears"])
                self.assertIsNotNone(p["avgIncreasePct"])

    def test_calculate_no_premiums_is_valid_empty_result(self):
        status, cache_control, body = self.get("/api/calculate?models=PHARM")
        self.assertEqual(status, 200)
        self.assertEqual(cache_control, self.success_cache_control)
        self.assertEqual(body["plans"], [])

    def test_franchises(self):
        status, _, body = self.get("/api/franchises?yob=1990")
        self.assertEqual(status, 200)
        self.assertEqual(len(body["franchises"]), 6)

    def test_locations(self):
        status, _, body = self.get("/api/locations")
        self.assertEqual(status, 200)
        self.assertIn("80011450512497", body["names"])

    def test_maintenance_page_is_502_without_cache(self):
        cases = [
            ("/api/calculate", "display=savings"),
            ("/api/calculate", "display=comparison"),
            ("/api/calculate", "display=change"),
            ("/api/franchises?yob=1990", "/de/praemien/franchises"),
            ("/api/locations", "/de/praemien/locations"),
        ]
        for path, broken in cases:
            with self.subTest(path=path, broken=broken):
                status, cache_control, _ = self.get(path, broken)
                self.assertEqual(status, 502)
                self.assertIsNone(cache_control)


class LocalServerTest(VercelHandlerTest):
    """Same checks against server.py; it never sends Cache-Control."""

    handler_cls = server.PriminfoHandler
    success_cache_control = None


if __name__ == "__main__":
    unittest.main()
