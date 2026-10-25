"""Regenerate tests/fixtures/ from the live upstream (needs network).

usage (from the repo root): python3 -m tests.make_fixtures

Pages are trimmed to keep the fixtures small: only the <table> elements the parsers
read (their order matters), only the rows of KEEP_INSURERS, only the locations in
KEEP_ZIPS. Re-run after the yearly upstream update (September), then fix the tests.
"""
import json
import re
import urllib.parse
from pathlib import Path

import api.index as api

FIXTURES = Path(__file__).parent / "fixtures"
# KPT: "—" price at franchise 2000; KPT/ÖKK: soft hyphens in model names; Einsiedeln: single plan
KEEP_INSURERS = {"KPT", "ÖKK", "Einsiedeln"}
KEEP_ZIPS = ("1000 ", "6900 ", "8001 ", "9658 ")


def premiums_path(display: str, models: list) -> str:
    params = [("location_id", "80011450512497"), ("yob[0]", "1990"), ("franchise[0]", "2500"), ("coverage[0]", "0")]
    params += [("insurer", ""), ("plan", "")] + [("models[]", m) for m in models] + [("display", display)]
    return "/de/praemien?" + urllib.parse.urlencode(params)


def trim_tables(html: str) -> str:
    tables = re.findall(r"<table\b.*?</table>", html, re.DOTALL)
    if len(tables) != 2:
        raise SystemExit(f"expected 2 tables, got {len(tables)}")
    kept = set()

    def keep_row(m):
        first_cell = re.search(r"<(th|td)\b[^>]*>(.*?)</\1>", m.group(0), re.DOTALL)
        insurer = api.clean_text(first_cell.group(2))
        if insurer not in KEEP_INSURERS:
            return ""
        kept.add(insurer)
        return m.group(0)

    data = tables[1]
    tbody = data.index("<tbody")
    tables[1] = data[:tbody] + re.sub(r"<tr\b.*?</tr>", keep_row, data[tbody:], flags=re.DOTALL)
    if kept != KEEP_INSURERS:
        raise SystemExit(f"insurers missing upstream: {KEEP_INSURERS - kept}")
    return "\n".join(tables) + "\n"


def trim_no_premiums(html: str) -> str:
    m = re.search(r'<p class="alert\b.*?</p>', html, re.DOTALL)
    if not m or "keine Prämien" not in m.group(0):
        raise SystemExit("no 'keine Prämien' alert in PHARM-only page")
    return m.group(0) + "\n"


def trim_locations(raw: str) -> str:
    start, end = raw.find("{"), raw.rfind("}") + 1
    data = json.loads(raw[start:end])
    names = {k: v for k, v in data["names"].items() if v.startswith(KEEP_ZIPS)}
    index = {}
    for key, ids in data["index"].items():
        ids = [i for i in ids if i in names]
        if ids:
            index[key] = ids
    return raw[:start] + json.dumps({"index": index, "names": names}, separators=(",", ":")) + raw[end:]


def main():
    all_models = ["BASE", "FLEX", "PRAXIS", "TEL_DIG", "PHARM"]
    files = {
        "savings.html": trim_tables(api.fetch_upstream(premiums_path("savings", all_models))),
        "comparison.html": trim_tables(api.fetch_upstream(premiums_path("comparison", all_models))),
        "change.html": trim_tables(api.fetch_upstream(premiums_path("change", all_models))),
        "no_premiums.html": trim_no_premiums(api.fetch_upstream(premiums_path("savings", ["PHARM"]))),
        "franchises.html": api.fetch_upstream("/de/praemien/franchises?yob=1990"),
        "locations.js": trim_locations(api.fetch_upstream("/de/praemien/locations")),
    }
    for name, text in files.items():
        (FIXTURES / name).write_text(text, encoding="utf-8")
        print(f"{name}: {len(text.encode())} bytes")


if __name__ == "__main__":
    main()
