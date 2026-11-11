// Cloudflare Pages Function porting api/index.py 1:1 so the app runs purely serverless on *.pages.dev
// alongside Vercel (api/index.py) and local dev (server.py), with zero npm dependencies.

const BASE_URL = "https://www.priminfo.admin.ch";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const STATUS_PHRASES = {
  404: "Not Found",
  500: "Internal Server Error",
  502: "Bad Gateway",
};

export class EmptyResultError extends Error {
  constructor(message) {
    super(message);
    this.name = "EmptyResultError";
  }
}

export class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = "NotFoundError";
  }
}

export async function defaultFetchUpstream(pathWithQuery) {
  const resp = await fetch(`${BASE_URL}${pathWithQuery}`, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "de-CH,de;q=0.9,en;q=0.8",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) {
    throw new Error(`Upstream HTTP ${resp.status} for ${pathWithQuery}`);
  }
  return resp.text();
}

export async function getLocationsJson(fetchUpstream = defaultFetchUpstream) {
  const raw = await fetchUpstream("/de/praemien/locations");
  const idx = raw.indexOf("{");
  const rIdx = raw.lastIndexOf("}");
  if (idx !== -1 && rIdx !== -1 && rIdx >= idx) {
    try {
      return JSON.parse(raw.slice(idx, rIdx + 1));
    } catch {
      // e.g. CSS braces in an HTML maintenance page
    }
  }
  return { index: {}, names: {} };
}

export function parseSelectOptions(html) {
  const options = [];
  let currentGroup = null;
  const tagRe = /<(optgroup|option|\/optgroup)\b([^>]*)>/gi;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    const pos = tagRe.lastIndex;
    if (tag === "optgroup") {
      const lblM = /label="([^"]*)"/.exec(attrs);
      currentGroup = lblM ? lblM[1].trim() : null;
    } else if (tag === "/optgroup") {
      currentGroup = null;
    } else if (tag === "option") {
      const valM = /value="([^"]*)"/.exec(attrs);
      const endOpt = html.indexOf("</option>", pos);
      if (endOpt === -1) continue;
      const label = html.slice(pos, endOpt).replace(/<[^>]+>/g, "").trim();
      tagRe.lastIndex = endOpt + 9;
      if (valM !== null) {
        const val = valM[1].trim();
        if (val !== "") {
          options.push({ value: val, label, group: currentGroup });
        }
      }
    }
  }
  return options;
}

export function cleanNum(val) {
  if (!val) return null;
  const s = val
    .replaceAll("'", "")
    .replaceAll("\u2019", "")
    .replaceAll(" ", "")
    .replaceAll("%", "")
    .replaceAll("\u00ad", "")
    .trim();
  if (s === "—" || s === "-" || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function cleanText(htmlFragment) {
  return htmlFragment
    .replace(/<[^>]+>/g, " ")
    .replaceAll("\u00ad", "")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractTables(html) {
  const tables = [];
  const tableRe = /<table\b([^>]*)>([\s\S]*?)<\/table>/gi;
  let tblM;
  while ((tblM = tableRe.exec(html)) !== null) {
    const tblAttrs = tblM[1];
    const tblBody = tblM[2];
    const idM = /id="([^"]*)"/.exec(tblAttrs);
    const tblId = idM ? idM[1] : "";

    const theadM = /<thead\b[^>]*>([\s\S]*?)<\/thead>/i.exec(tblBody);
    const headers = [];
    if (theadM) {
      for (const thM of theadM[1].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)) {
        headers.push(cleanText(thM[1]));
      }
    }

    const tbodyM = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i.exec(tblBody);
    const rows = [];
    if (tbodyM) {
      for (const trM of tbodyM[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const rowHtml = trM[1];
        const cells = [];
        for (const cellM of rowHtml.matchAll(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
          const cAttrs = cellM[2];
          const cInner = cellM[3];
          const hrefM = /href="([^"]*)"/.exec(cInner);
          const divs = [...cInner.matchAll(/<div\b[^>]*>([\s\S]*?)<\/div>/gi)].map((d) =>
            cleanText(d[1]),
          );
          cells.push({
            text: cleanText(cInner),
            href: hrefM ? hrefM[1] : null,
            divs,
            attrs: cAttrs,
          });
        }
        if (cells.length > 0) rows.push(cells);
      }
    }
    tables.push({ id: tblId, headers, rows });
  }
  return tables;
}

export function parseSavingsHtml(html) {
  const tables = extractTables(html);
  let target = tables.find((t) => t.id === "savingsTable") || null;
  if (!target && tables.length > 1) target = tables[1];
  if (!target) return [];

  const results = [];
  const hasSavingsCols = target.headers.length >= 10;
  for (const row of target.rows) {
    if (row.length < 8) continue;
    const insurer = row[0].text;
    const insurerUrl = row[0].href;
    const model = row[1].text;
    let monthlyDiff, yearlyDiff, monthlyGross, monthlyRebate, monthlyNet, yearlyGross, yearlyRebate, yearlyNet;
    if (hasSavingsCols && row.length >= 10) {
      monthlyDiff = cleanNum(row[2].text);
      yearlyDiff = cleanNum(row[3].text);
      monthlyGross = cleanNum(row[4].text);
      monthlyRebate = cleanNum(row[5].text);
      monthlyNet = cleanNum(row[6].text);
      yearlyGross = cleanNum(row[7].text);
      yearlyRebate = cleanNum(row[8].text);
      yearlyNet = cleanNum(row[9].text);
    } else {
      monthlyDiff = null;
      yearlyDiff = null;
      monthlyGross = cleanNum(row[2].text);
      monthlyRebate = cleanNum(row[3].text);
      monthlyNet = cleanNum(row[4].text);
      yearlyGross = cleanNum(row[5].text);
      yearlyRebate = cleanNum(row[6].text);
      yearlyNet = cleanNum(row[7].text);
    }
    results.push({
      insurer,
      insurerUrl,
      model,
      monthlyDiff,
      yearlyDiff,
      monthlyGross,
      monthlyRebate: monthlyRebate || 0.0,
      monthlyNet,
      yearlyGross,
      yearlyRebate: yearlyRebate || 0.0,
      yearlyNet,
    });
  }
  return results;
}

export function parseComparisonHtml(html) {
  const tables = extractTables(html);
  if (tables.length < 2) return { franchises: [], rows: [] };
  const target = tables[1];
  const franchises = [];
  for (const h of target.headers.slice(2)) {
    const val = cleanNum(h);
    if (val !== null) franchises.push(Math.trunc(val));
  }
  const rows = [];
  for (const r of target.rows) {
    if (r.length < 2 + franchises.length) continue;
    const insurer = r[0].text;
    const model = r[1].text;
    const prices = {};
    for (let idx = 0; idx < franchises.length; idx++) {
      prices[String(franchises[idx])] = cleanNum(r[2 + idx].text);
    }
    rows.push({ insurer, model, prices });
  }
  return { franchises, rows };
}

export function parseChangeHtml(html) {
  const tables = extractTables(html);
  if (tables.length < 2) return { years: [], rows: [] };
  const target = tables[1];
  const years = target.headers.slice(1, -1).filter((h) => /^\d{4}$/.test(h.trim()));
  const rows = [];
  for (const r of target.rows) {
    if (r.length < 1 + years.length) continue;
    const insurer = r[0].text;
    const history = {};
    for (let idx = 0; idx < years.length; idx++) {
      const y = years[idx];
      const cell = r[1 + idx];
      const divs = cell.divs;
      const premium = divs.length > 0 ? cleanNum(divs[0]) : cleanNum(cell.text);
      const changePct = divs.length > 1 ? cleanNum(divs[1]) : null;
      history[y] = { premium, changePct };
    }
    const avgIncrease = cleanNum(r[r.length - 1].text);
    rows.push({ insurer, history, avgIncreasePct: avgIncrease });
  }
  return { years, rows };
}

export function classifyModelType(modelName) {
  const m = modelName.toLowerCase();
  if (m.includes("grundversicherung") || m === "standard" || m === "base") return "BASE";
  if (["pharm", "apotheke", "medpharm", "casamed pharm", "pharmed"].some((k) => m.includes(k))) {
    return "PHARM";
  }
  if (["tel", "call", "24", "smartmed", "qualimed", "sanmed", "med call", "meditel"].some((k) => m.includes(k))) {
    return "TEL_DIG";
  }
  if (
    ["flex", "multimed", "multiaccess", "multichoice", "combi", "win.win", "smartcare", "benef"].some((k) =>
      m.includes(k),
    )
  ) {
    return "FLEX";
  }
  return "PRAXIS";
}

export function parseQs(searchParams) {
  const qs = {};
  for (const [k, v] of searchParams.entries()) {
    if (v === "") continue;
    if (!qs[k]) qs[k] = [];
    qs[k].push(v);
  }
  return qs;
}

function first(qs, key, fallback) {
  return qs[key] && qs[key].length > 0 ? qs[key][0] : fallback;
}

export async function handleApiRequest(path, qs, fetchUpstream = defaultFetchUpstream) {
  if (path === "/api/locations") {
    const data = await getLocationsJson(fetchUpstream);
    if (!data.names || Object.keys(data.names).length === 0) {
      throw new EmptyResultError(`Empty upstream result: ${path}`);
    }
    return data;
  }

  if (path === "/api/insurers") {
    const loc = first(qs, "location", "");
    if (!loc) return { insurers: [] };
    const raw = await fetchUpstream(`/de/praemien/insurers?location=${encodeURIComponent(loc)}`);
    return { insurers: parseSelectOptions(raw) };
  }

  if (path === "/api/plans") {
    const loc = first(qs, "location", "");
    const ins = first(qs, "insurer", "");
    if (!loc || !ins) return { plans: [] };
    const raw = await fetchUpstream(
      `/de/praemien/plans?insurer=${encodeURIComponent(ins)}&location=${encodeURIComponent(loc)}`,
    );
    return { plans: parseSelectOptions(raw) };
  }

  if (path === "/api/franchises") {
    const yob = first(qs, "yob", "1990");
    const raw = await fetchUpstream(`/de/praemien/franchises?yob=${encodeURIComponent(yob)}`);
    const franchises = parseSelectOptions(raw);
    if (franchises.length === 0) {
      throw new EmptyResultError(`Empty upstream result: ${path}`);
    }
    return { franchises };
  }

  if (path === "/api/calculate") {
    const loc = first(qs, "location_id", "80011450512497");
    const yob = first(qs, "yob", "1990");
    const franchise = first(qs, "franchise", "2500");
    const coverage = first(qs, "coverage", "0");
    const insurer = first(qs, "insurer", "");
    const plan = first(qs, "plan", "");
    let models = qs.models && qs.models.length > 0 ? [...qs.models] : ["BASE", "FLEX", "PRAXIS", "TEL_DIG", "PHARM"];
    if (models.length === 1 && models[0].includes(",")) {
      models = models[0]
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean);
    }

    const baseParams = [
      ["location_id", loc],
      ["yob[0]", yob],
      ["franchise[0]", franchise],
      ["coverage[0]", coverage],
      ["insurer", insurer],
      ["plan", plan],
    ];
    for (const m of models) {
      baseParams.push(["models[]", m]);
    }

    const buildUrl = (displayMode) => {
      const p = new URLSearchParams([...baseParams, ["display", displayMode]]);
      return `/de/praemien?${p.toString()}`;
    };

    const [savHtml, cmpHtml, chgHtml] = await Promise.all([
      fetchUpstream(buildUrl("savings")),
      fetchUpstream(buildUrl("comparison")),
      fetchUpstream(buildUrl("change")),
    ]);

    const savingsList = parseSavingsHtml(savHtml);
    const comparisonData = parseComparisonHtml(cmpHtml);
    const changeData = parseChangeHtml(chgHtml);

    // Upstream says "keine Prämien" when the chosen model categories have no premiums this year (e.g. PHARM only)
    const noPremiums = savingsList.length === 0 && savHtml.includes("keine Prämien");
    if (
      !noPremiums &&
      !(savingsList.length > 0 && comparisonData.rows.length > 0 && changeData.rows.length > 0)
    ) {
      throw new EmptyResultError(`Empty upstream result: ${path}`);
    }

    const matrixMap = new Map(
      comparisonData.rows.map((r) => [`${r.insurer}\0${r.model}`, r.prices]),
    );
    const changeMap = new Map(
      changeData.rows.map((r) => [r.insurer, { history: r.history, avgIncreasePct: r.avgIncreasePct }]),
    );

    const monthlyRebate = savingsList.length > 0 ? savingsList[0].monthlyRebate : 4.75;

    for (const item of savingsList) {
      item.matrixPrices = matrixMap.get(`${item.insurer}\0${item.model}`) || {};
      item.modelCategory = classifyModelType(item.model);
      const chgInfo = changeMap.get(item.insurer) || {};
      item.avgIncreasePct = chgInfo.avgIncreasePct ?? null;
      item.history = chgInfo.history || {};
    }

    return {
      meta: {
        premiumYear: 2027,
        dataPublished: "2026-09-24",
        locationId: loc,
        yob: /^\d+$/.test(yob) ? Number(yob) : 1990,
        selectedFranchise: /^\d+$/.test(franchise) ? Number(franchise) : 2500,
        coverage: /^\d+$/.test(coverage) ? Number(coverage) : 0,
        monthlyRebate,
        franchises: comparisonData.franchises,
        historyYears: changeData.years,
      },
      plans: savingsList,
      insurerHistory: changeData.rows,
    };
  }

  throw new NotFoundError(`Unknown API endpoint: ${path}`);
}

export async function handleRequest(request, { fetchUpstream = defaultFetchUpstream, waitUntil = null } = {}) {
  const url = new URL(request.url);
  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;
  const cacheKey = new Request(url.toString(), { method: "GET" });
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  const qs = parseQs(url.searchParams);
  try {
    const data = await handleApiRequest(url.pathname, qs, fetchUpstream);
    const response = new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=60, s-maxage=3600, stale-while-revalidate",
        "Access-Control-Allow-Origin": "*",
      },
    });
    if (cache) {
      const store = cache.put(cacheKey, response.clone());
      if (waitUntil) waitUntil(store);
      else await store;
    }
    return response;
  } catch (e) {
    const status = e instanceof NotFoundError ? 404 : e instanceof EmptyResultError ? 502 : 500;
    console.warn(`GET ${url.pathname}${url.search} -> ${status}: ${e?.message || e}`);
    return new Response(JSON.stringify({ error: STATUS_PHRASES[status] }), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  }
}

export function onRequestGet(context) {
  return handleRequest(context.request, { waitUntil: (p) => context.waitUntil(p) });
}
