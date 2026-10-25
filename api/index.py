from http.server import BaseHTTPRequestHandler
import json
import re
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE_URL = "https://www.priminfo.admin.ch"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"

CACHE = {}
CACHE_TTL = 3600


class EmptyResultError(Exception):
    """Upstream page parsed to nothing (layout change or error page); served as 502 without cache headers."""


class NotFoundError(Exception):
    """Unknown /api/* path; served as 404 without cache headers."""


def fetch_upstream(path_with_query: str) -> str:
    now = time.time()
    if path_with_query in CACHE:
        ts, data = CACHE[path_with_query]
        if now - ts < CACHE_TTL:
            return data

    url = f"{BASE_URL}{path_with_query}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "de-CH,de;q=0.9,en;q=0.8",
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        text = resp.read().decode("utf-8", errors="replace")
    CACHE[path_with_query] = (now, text)
    return text


def get_locations_json() -> dict:
    raw = fetch_upstream("/de/praemien/locations")
    idx = raw.find("{")
    r_idx = raw.rfind("}")
    if idx != -1 and r_idx != -1:
        try:
            return json.loads(raw[idx : r_idx + 1])
        except ValueError:  # e.g. CSS braces in an HTML error page
            pass
    return {"index": {}, "names": {}}


def parse_select_options(html: str) -> list:
    options = []
    current_group = None
    tag_re = re.compile(r'<(optgroup|option|/optgroup)\b([^>]*)>', re.IGNORECASE)
    pos = 0
    while True:
        m = tag_re.search(html, pos)
        if not m:
            break
        tag = m.group(1).lower()
        attrs = m.group(2)
        pos = m.end()
        if tag == "optgroup":
            lbl_m = re.search(r'label="([^"]*)"', attrs)
            current_group = lbl_m.group(1).strip() if lbl_m else None
        elif tag == "/optgroup":
            current_group = None
        elif tag == "option":
            val_m = re.search(r'value="([^"]*)"', attrs)
            end_opt = html.find("</option>", pos)
            if end_opt == -1:
                continue
            label = re.sub(r"<[^>]+>", "", html[pos:end_opt]).strip()
            pos = end_opt + 9
            if val_m is not None:
                val = val_m.group(1).strip()
                if val != "":
                    options.append({"value": val, "label": label, "group": current_group})
    return options


def clean_num(val: str):
    if not val:
        return None
    s = (
        val.replace("'", "")
        .replace("\u2019", "")
        .replace(" ", "")
        .replace("%", "")
        .replace("\u00ad", "")
        .strip()
    )
    if s in ("—", "-", ""):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def clean_text(html_fragment: str) -> str:
    txt = re.sub(r"<[^>]+>", " ", html_fragment)
    txt = txt.replace("\u00ad", "").replace("&nbsp;", " ").replace("&amp;", "&")
    return re.sub(r"\s+", " ", txt).strip()


def extract_tables(html: str) -> list:
    tables = []
    for tbl_m in re.finditer(r"<table\b([^>]*)>(.*?)</table>", html, re.DOTALL | re.IGNORECASE):
        tbl_attrs = tbl_m.group(1)
        tbl_body = tbl_m.group(2)
        id_m = re.search(r'id="([^"]*)"', tbl_attrs)
        tbl_id = id_m.group(1) if id_m else ""

        thead_m = re.search(r"<thead\b[^>]*>(.*?)</thead>", tbl_body, re.DOTALL | re.IGNORECASE)
        headers = []
        if thead_m:
            for th_m in re.finditer(r"<th\b[^>]*>(.*?)</th>", thead_m.group(1), re.DOTALL | re.IGNORECASE):
                headers.append(clean_text(th_m.group(1)))

        tbody_m = re.search(r"<tbody\b[^>]*>(.*?)</tbody>", tbl_body, re.DOTALL | re.IGNORECASE)
        rows = []
        if tbody_m:
            for tr_m in re.finditer(r"<tr\b[^>]*>(.*?)</tr>", tbody_m.group(1), re.DOTALL | re.IGNORECASE):
                row_html = tr_m.group(1)
                cells = []
                for cell_m in re.finditer(r"<(th|td)\b([^>]*)>(.*?)</\1>", row_html, re.DOTALL | re.IGNORECASE):
                    c_attrs = cell_m.group(2)
                    c_inner = cell_m.group(3)
                    href_m = re.search(r'href="([^"]*)"', c_inner)
                    divs = [
                        clean_text(d.group(1))
                        for d in re.finditer(r"<div\b[^>]*>(.*?)</div>", c_inner, re.DOTALL | re.IGNORECASE)
                    ]
                    cells.append(
                        {
                            "text": clean_text(c_inner),
                            "href": href_m.group(1) if href_m else None,
                            "divs": divs,
                            "attrs": c_attrs,
                        }
                    )
                if cells:
                    rows.append(cells)
        tables.append({"id": tbl_id, "headers": headers, "rows": rows})
    return tables


def parse_savings_html(html: str) -> list:
    tables = extract_tables(html)
    target = next((t for t in tables if t["id"] == "savingsTable"), None)
    if not target and len(tables) > 1:
        target = tables[1]
    if not target:
        return []

    results = []
    has_savings_cols = len(target["headers"]) >= 10
    for row in target["rows"]:
        if len(row) < 8:
            continue
        insurer = row[0]["text"]
        insurer_url = row[0]["href"]
        model = row[1]["text"]
        if has_savings_cols and len(row) >= 10:
            monthly_diff = clean_num(row[2]["text"])
            yearly_diff = clean_num(row[3]["text"])
            monthly_gross = clean_num(row[4]["text"])
            monthly_rebate = clean_num(row[5]["text"])
            monthly_net = clean_num(row[6]["text"])
            yearly_gross = clean_num(row[7]["text"])
            yearly_rebate = clean_num(row[8]["text"])
            yearly_net = clean_num(row[9]["text"])
        else:
            monthly_diff = None
            yearly_diff = None
            monthly_gross = clean_num(row[2]["text"])
            monthly_rebate = clean_num(row[3]["text"])
            monthly_net = clean_num(row[4]["text"])
            yearly_gross = clean_num(row[5]["text"])
            yearly_rebate = clean_num(row[6]["text"])
            yearly_net = clean_num(row[7]["text"])

        results.append(
            {
                "insurer": insurer,
                "insurerUrl": insurer_url,
                "model": model,
                "monthlyDiff": monthly_diff,
                "yearlyDiff": yearly_diff,
                "monthlyGross": monthly_gross,
                "monthlyRebate": monthly_rebate or 0.0,
                "monthlyNet": monthly_net,
                "yearlyGross": yearly_gross,
                "yearlyRebate": yearly_rebate or 0.0,
                "yearlyNet": yearly_net,
            }
        )
    return results


def parse_comparison_html(html: str) -> dict:
    tables = extract_tables(html)
    if len(tables) < 2:
        return {"franchises": [], "rows": []}
    target = tables[1]
    franchises = []
    for h in target["headers"][2:]:
        val = clean_num(h)
        if val is not None:
            franchises.append(int(val))

    rows = []
    for r in target["rows"]:
        if len(r) < 2 + len(franchises):
            continue
        insurer = r[0]["text"]
        model = r[1]["text"]
        prices = {}
        for idx, f_val in enumerate(franchises):
            p = clean_num(r[2 + idx]["text"])
            prices[str(f_val)] = p
        rows.append({"insurer": insurer, "model": model, "prices": prices})
    return {"franchises": franchises, "rows": rows}


def parse_change_html(html: str) -> dict:
    tables = extract_tables(html)
    if len(tables) < 2:
        return {"years": [], "rows": []}
    target = tables[1]
    years = [h for h in target["headers"][1:-1] if re.match(r"^\d{4}$", h.strip())]
    rows = []
    for r in target["rows"]:
        if len(r) < 1 + len(years):
            continue
        insurer = r[0]["text"]
        history = {}
        for idx, y in enumerate(years):
            cell = r[1 + idx]
            divs = cell["divs"]
            premium = clean_num(divs[0]) if len(divs) > 0 else clean_num(cell["text"])
            change_pct = clean_num(divs[1]) if len(divs) > 1 else None
            history[y] = {"premium": premium, "changePct": change_pct}
        avg_cell = r[-1]["text"]
        avg_increase = clean_num(avg_cell)
        rows.append({"insurer": insurer, "history": history, "avgIncreasePct": avg_increase})
    return {"years": years, "rows": rows}


def classify_model_type(model_name: str) -> str:
    m = model_name.lower()
    if "grundversicherung" in m or m == "standard" or m == "base":
        return "BASE"
    if any(k in m for k in ["pharm", "apotheke", "medpharm", "casamed pharm", "pharmed"]):
        return "PHARM"
    if any(k in m for k in ["tel", "call", "24", "smartmed", "qualimed", "sanmed", "med call", "meditel"]):
        return "TEL_DIG"
    if any(k in m for k in ["flex", "multimed", "multiaccess", "multichoice", "combi", "win.win", "smartcare", "benef"]):
        return "FLEX"
    return "PRAXIS"


def handle_api_request(path: str, qs: dict) -> dict:
    if path == "/api/locations":
        data = get_locations_json()
        if not data.get("names"):
            raise EmptyResultError(f"Empty upstream result: {path}")
        return data

    elif path == "/api/insurers":
        loc = qs.get("location", [""])[0]
        if not loc:
            return {"insurers": []}
        raw = fetch_upstream(f"/de/praemien/insurers?location={urllib.parse.quote(loc)}")
        return {"insurers": parse_select_options(raw)}

    elif path == "/api/plans":
        loc = qs.get("location", [""])[0]
        ins = qs.get("insurer", [""])[0]
        if not loc or not ins:
            return {"plans": []}
        raw = fetch_upstream(f"/de/praemien/plans?insurer={urllib.parse.quote(ins)}&location={urllib.parse.quote(loc)}")
        return {"plans": parse_select_options(raw)}

    elif path == "/api/franchises":
        yob = qs.get("yob", ["1990"])[0]
        raw = fetch_upstream(f"/de/praemien/franchises?yob={urllib.parse.quote(yob)}")
        franchises = parse_select_options(raw)
        if not franchises:
            raise EmptyResultError(f"Empty upstream result: {path}")
        return {"franchises": franchises}

    elif path == "/api/calculate":
        loc = qs.get("location_id", ["80011450512497"])[0]
        yob = qs.get("yob", ["1990"])[0]
        franchise = qs.get("franchise", ["2500"])[0]
        coverage = qs.get("coverage", ["0"])[0]
        insurer = qs.get("insurer", [""])[0]
        plan = qs.get("plan", [""])[0]
        models = qs.get("models", ["BASE", "FLEX", "PRAXIS", "TEL_DIG", "PHARM"])
        if len(models) == 1 and "," in models[0]:
            models = [m.strip() for m in models[0].split(",") if m.strip()]

        base_params = [
            ("location_id", loc),
            ("yob[0]", yob),
            ("franchise[0]", franchise),
            ("coverage[0]", coverage),
            ("insurer", insurer),
            ("plan", plan),
        ]
        for m in models:
            base_params.append(("models[]", m))

        def build_url(display_mode: str) -> str:
            p = base_params + [("display", display_mode)]
            return "/de/praemien?" + urllib.parse.urlencode(p)

        with ThreadPoolExecutor(max_workers=3) as ex:
            f_sav = ex.submit(fetch_upstream, build_url("savings"))
            f_cmp = ex.submit(fetch_upstream, build_url("comparison"))
            f_chg = ex.submit(fetch_upstream, build_url("change"))
            sav_html = f_sav.result()
            cmp_html = f_cmp.result()
            chg_html = f_chg.result()

        savings_list = parse_savings_html(sav_html)
        comparison_data = parse_comparison_html(cmp_html)
        change_data = parse_change_html(chg_html)

        # Upstream says "keine Prämien" when the chosen model categories have no premiums this year (e.g. PHARM only)
        no_premiums = not savings_list and "keine Prämien" in sav_html
        if not no_premiums and not (savings_list and comparison_data["rows"] and change_data["rows"]):
            raise EmptyResultError(f"Empty upstream result: {path}")

        matrix_map = {(r["insurer"], r["model"]): r["prices"] for r in comparison_data["rows"]}
        change_map = {
            r["insurer"]: {"history": r["history"], "avgIncreasePct": r["avgIncreasePct"]}
            for r in change_data["rows"]
        }

        monthly_rebate = savings_list[0]["monthlyRebate"] if savings_list else 4.75

        for item in savings_list:
            key = (item["insurer"], item["model"])
            item["matrixPrices"] = matrix_map.get(key, {})
            item["modelCategory"] = classify_model_type(item["model"])
            chg_info = change_map.get(item["insurer"], {})
            item["avgIncreasePct"] = chg_info.get("avgIncreasePct")
            item["history"] = chg_info.get("history", {})

        return {
            "meta": {
                "premiumYear": 2027,
                "dataPublished": "2026-09-24",
                "locationId": loc,
                "yob": int(yob) if yob.isdigit() else 1990,
                "selectedFranchise": int(franchise) if franchise.isdigit() else 2500,
                "coverage": int(coverage) if coverage.isdigit() else 0,
                "monthlyRebate": monthly_rebate,
                "franchises": comparison_data["franchises"],
                "historyYears": change_data["years"],
            },
            "plans": savings_list,
            "insurerHistory": change_data["rows"],
        }

    raise NotFoundError(f"Unknown API endpoint: {path}")


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        try:
            data = handle_api_request(parsed.path, qs)
            body = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "s-maxage=3600, stale-while-revalidate")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            status = 404 if isinstance(e, NotFoundError) else 502 if isinstance(e, EmptyResultError) else 500
            body = json.dumps({"error": str(e)}, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(body)
