import { I18N } from "../i18n/index.js";
import { fmtChf, fmtSignedPct, esc, getTrendBadgeHtml } from "../format.js";
import { state, getEnrichedPlans, filterAndSortPlans } from "../state.js";

const DEFAULT_RANKING_LIMIT = 25;

export function renderKpis(plans, rebate) {
  const dict = I18N[state.lang] || I18N.en;
  if (plans.length === 0) return;
  const sortedByMonthly = plans
    .filter(p => p.monthlyNet !== null && p.monthlyNet !== undefined)
    .sort((a, b) => a.monthlyNet - b.monthlyNet);
  const cheapest = sortedByMonthly[0];
  const priciest = sortedByMonthly[sortedByMonthly.length - 1];

  if (cheapest) {
    const maxSavings = (priciest.yearlyNet || 0) - (cheapest.yearlyNet || 0);
    document.getElementById("kpi-min-monthly").textContent = `CHF ${fmtChf(cheapest.monthlyNet)}`;
    document.getElementById("kpi-min-plan").textContent = `${cheapest.insurer} · ${cheapest.model}`;

    document.getElementById("kpi-max-savings").textContent = `CHF ${fmtChf(maxSavings, 0)}`;
    document.getElementById("kpi-savings-sub").textContent = dict.vsPriciest(priciest.insurer, priciest.monthlyNet);
  } else {
    for (const id of ["kpi-min-monthly", "kpi-min-plan", "kpi-max-savings", "kpi-savings-sub"]) {
      document.getElementById(id).textContent = "—";
    }
  }

  const hist = (state.data.insurerHistory || []).filter(h => h.avgIncreasePct !== null && h.avgIncreasePct !== undefined);
  hist.sort((a, b) => a.avgIncreasePct - b.avgIncreasePct);
  if (hist.length > 0) {
    const lowest = hist[0];
    const worst = hist[hist.length - 1];
    document.getElementById("kpi-most-stable").textContent = `${lowest.insurer} (${fmtSignedPct(lowest.avgIncreasePct)})`;
    document.getElementById("kpi-stable-sub").textContent = dict.highestIncrease(worst.insurer, worst.avgIncreasePct);
  }

  document.getElementById("kpi-plan-count").textContent = `${plans.length}`;
  document.getElementById("kpi-rebate-info").textContent = dict.rebateDeducted(rebate);
}

function getCategoryTip(cat) {
  const dict = I18N[state.lang] || I18N.en;
  const map = {
    BASE: dict.tipBase,
    FLEX: dict.tipFlex,
    PRAXIS: dict.tipPraxis,
    TEL_DIG: dict.tipTel,
    PHARM: dict.tipPharm
  };
  return map[cat] || "";
}

export function renderRankingTable(plans) {
  const dict = I18N[state.lang] || I18N.en;
  const tbody = document.getElementById("ranking-tbody");
  const loadMoreWrap = document.getElementById("ranking-load-more-wrap");
  const loadMoreBtn = document.getElementById("btn-load-more");

  const filtered = filterAndSortPlans(plans);
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:2rem;">${dict.emptyPlans}</td></tr>`;
    loadMoreWrap.classList.add("hidden");
    return;
  }

  const visibleRows = state.showAllRankingRows
    ? filtered
    : filtered.slice(0, DEFAULT_RANKING_LIMIT);

  if (filtered.length > DEFAULT_RANKING_LIMIT) {
    loadMoreWrap.classList.remove("hidden");
    loadMoreBtn.textContent = state.showAllRankingRows
      ? dict.btnShowLessPlans(DEFAULT_RANKING_LIMIT)
      : dict.btnShowAllPlans(filtered.length, visibleRows.length);
  } else {
    loadMoreWrap.classList.add("hidden");
  }

  const catLabels = dict.catLabels;

  tbody.innerHTML = visibleRows.map((p, idx) => {
    // Only http(s) links: esc() alone does not stop javascript: URLs
    const insLink = /^https?:\/\//i.test(p.insurerUrl || "")
      ? `<a href="${esc(p.insurerUrl)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline dotted;">${esc(p.insurer)}</a>`
      : esc(p.insurer);
    const catTip = getCategoryTip(p.modelCategory);

    return `
      <tr>
        <td data-label="#">${idx + 1}</td>
        <th scope="row">${insLink}</th>
        <td data-label="${dict.thModel}">${esc(p.model)}</td>
        <td data-label="${dict.thCategory}">
          <span class="cat-tag cat-${p.modelCategory}" data-goto-guide="1" title="${catTip}">
            ${catLabels[p.modelCategory] || p.modelCategory}
          </span>
        </td>
        <td class="num-col" data-label="${dict.thMonthlyNet}"><strong>${fmtChf(p.monthlyNet)}</strong></td>
        <td class="num-col" data-label="${dict.thYearlyNet}">${fmtChf(p.yearlyNet)}</td>
        <td class="num-col" data-label="${dict.thOutOfPocket}">${fmtChf(p.outOfPocket)}</td>
        <td class="num-col highlight-col" data-label="${dict.thTotalRealCost}">${p.totalYearCost === null ? "—" : `CHF ${fmtChf(p.totalYearCost)}`}</td>
        <td class="num-col" data-label="${dict.th5YrAvg}" title="${dict.th5YrTooltip}">${getTrendBadgeHtml(p.avgIncreasePct)}</td>
        <td class="num-col" data-label="${dict.thCurveAction}">
          <button type="button" class="btn-curve-jump" data-plan-idx="${p.originalIdx}">${dict.btnSeeCurve}</button>
        </td>
      </tr>
    `;
  }).join("");
}

export function exportRankingToCsv() {
  const enriched = getEnrichedPlans();
  const filtered = filterAndSortPlans(enriched);
  if (!filtered.length) return;

  const headers = [
    "Rank", "Insurer", "Plan", "Category",
    "MonthlyNet_CHF", "YearlyNet_CHF", "EstOutOfPocket_CHF",
    "TotalAnnualCost_CHF", "Avg5YrIncrease_Pct"
  ];
  const lines = [headers.join(",")];
  filtered.forEach((p, idx) => {
    const row = [
      idx + 1,
      `"${(p.insurer || "").replace(/"/g, '""')}"`,
      `"${(p.model || "").replace(/"/g, '""')}"`,
      p.modelCategory,
      p.monthlyNet !== null && p.monthlyNet !== undefined ? p.monthlyNet.toFixed(2) : "",
      p.yearlyNet !== null && p.yearlyNet !== undefined ? p.yearlyNet.toFixed(2) : "",
      (p.outOfPocket ?? 0).toFixed(2),
      p.totalYearCost !== null ? p.totalYearCost.toFixed(2) : "",
      p.avgIncreasePct !== null && p.avgIncreasePct !== undefined ? p.avgIncreasePct.toFixed(1) : ""
    ];
    lines.push(row.join(","));
  });

  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const citySlug = (state.locationName || "swiss").replace(/[^a-zA-Z0-9]+/g, "-");
  a.href = url;
  a.download = `priminfo-2027-${citySlug}-${state.yob}-F${state.franchise}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
