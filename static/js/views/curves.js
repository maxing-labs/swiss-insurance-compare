import { I18N } from "../i18n/index.js";
import { fmtChf, esc } from "../format.js";
import { buildCurveSeries, findCrossover } from "../calc.js";
import { state } from "../state.js";
import { CHART_THEME } from "./chart-theme.js";

const FRANCHISE_COLORS = {
  0: "#2563eb",
  100: "#0891b2",
  200: "#0d9488",
  300: "#dc2626",
  400: "#b45309",
  500: "#ea580c",
  600: "#059669",
  1000: "#b45309",
  1500: "#7c3aed",
  2000: "#2563eb",
  2500: "#059669"
};

export function populateCurvePlanSelect() {
  const dict = I18N[state.lang] || I18N.zh;
  const sel = document.getElementById("curve-plan-select");
  if (!state.data?.plans || !sel) return;
  sel.innerHTML = state.data.plans.map((p, idx) =>
    `<option value="${idx}">${dict.curveOptionLabel(esc(p.insurer), esc(p.model), p.monthlyNet)}</option>`
  ).join("");
  sel.value = String(state.selectedCurvePlanIdx);
}

export function renderCurvesTab(plans, franchises, rebate, isKid) {
  const dict = I18N[state.lang] || I18N.zh;
  const plan = plans.find(p => p.originalIdx === state.selectedCurvePlanIdx) || plans[0];
  if (!plan) return;

  const sel = document.getElementById("curve-plan-select");
  if (sel && sel.value !== String(plan.originalIdx)) {
    sel.value = String(plan.originalIdx);
  }

  document.getElementById("curve-cost-readout").textContent = `CHF ${fmtChf(state.medicalCost, 0)}`;
  document.getElementById("chart-plan-title").textContent = dict.chartDynamicTitle(plan.insurer, plan.model);

  const maxX = 6000;
  const stepX = 100;
  const xPoints = [];
  for (let x = 0; x <= maxX; x += stepX) xPoints.push(x);

  const seriesList = buildCurveSeries(plan, { franchises, rebate, isKid, medicalCost: state.medicalCost, xPoints })
    .map(s => ({ ...s, color: FRANCHISE_COLORS[s.franchise] || "#64748b" }));

  if (seriesList.length === 0) return;

  let minY = Infinity;
  let maxY = -Infinity;
  for (const s of seriesList) {
    for (const pt of s.points) {
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
  }
  minY = Math.floor(minY / 200) * 200;
  maxY = Math.ceil(maxY / 200) * 200 + 100;
  if (maxY <= minY) maxY = minY + 1000;

  const legendEl = document.getElementById("chart-legend");
  legendEl.innerHTML = seriesList.map(s => `
    <span class="legend-item">
      <span class="legend-dot" style="background:${s.color}"></span>
      <span>F${s.franchise} (${fmtChf(s.netMonthly, 0)}${dict.perMonthShort})</span>
    </span>
  `).join("");

  const lowS = seriesList[0];
  const highS = seriesList[seriesList.length - 1];
  const crossoverX = findCrossover(lowS, highS, isKid, maxX);

  const sortedAtCursor = [...seriesList].sort((a, b) => a.cursorTotal - b.cursorTotal);
  // The same best franchise as the matrix: enrichPlans compares to the Rappen and keeps the selected one on a tie
  const bestAtCursor = seriesList.find(s => s.franchise === plan.bestFranchiseForPlan);
  const worstAtCursor = sortedAtCursor[sortedAtCursor.length - 1];

  const vTitle = document.getElementById("verdict-title");
  const vDesc = document.getElementById("verdict-desc");
  vTitle.textContent = dict.verdictTitle(state.medicalCost, bestAtCursor.franchise);
  const crossNote = crossoverX !== null
    ? dict.verdictCrossoverNote(crossoverX, highS.franchise, lowS.franchise)
    : "";
  vDesc.textContent = dict.verdictDesc(
    bestAtCursor.cursorTotal,
    worstAtCursor.franchise,
    worstAtCursor.cursorTotal - bestAtCursor.cursorTotal,
    crossNote
  );

  const svg = document.getElementById("breakeven-svg");
  const W = 820, H = 420;
  const padL = 72, padR = 28, padT = 26, padB = 44;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const scaleX = (x) => padL + (Math.min(maxX, Math.max(0, x)) / maxX) * plotW;
  const scaleY = (y) => padT + plotH - ((y - minY) / (maxY - minY)) * plotH;

  const svgParts = [];

  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const valY = minY + ((maxY - minY) * i) / yTicks;
    const py = scaleY(valY);
    svgParts.push(`<line x1="${padL}" y1="${py}" x2="${W - padR}" y2="${py}" stroke="${CHART_THEME.grid}" stroke-width="1" />`);
    svgParts.push(`<text x="${padL - 8}" y="${py + 4}" text-anchor="end" font-size="13" font-weight="600" fill="${CHART_THEME.axisText}">${fmtChf(valY, 0)}</text>`);
  }

  for (let x = 0; x <= maxX; x += 1000) {
    const px = scaleX(x);
    svgParts.push(`<line x1="${px}" y1="${padT}" x2="${px}" y2="${H - padB}" stroke="${CHART_THEME.grid}" stroke-width="1" />`);
    svgParts.push(`<text x="${px}" y="${H - padB + 22}" text-anchor="middle" font-size="13" font-weight="600" fill="${CHART_THEME.axisText}">CHF ${fmtChf(x, 0)}</text>`);
  }

  if (crossoverX !== null) {
    const cx = scaleX(crossoverX);
    svgParts.push(`<line x1="${cx}" y1="${padT}" x2="${cx}" y2="${H - padB}" stroke="${CHART_THEME.crossover}" stroke-width="1.8" stroke-dasharray="4 4" />`);
    svgParts.push(`<text x="${cx + 6}" y="${padT + 16}" font-size="13" font-weight="700" fill="${CHART_THEME.crossover}">${dict.crossoverLabel(crossoverX)}</text>`);
  }

  for (const s of seriesList) {
    const isExtremes = s.franchise === lowS.franchise || s.franchise === highS.franchise;
    const strokeW = s.franchise === bestAtCursor.franchise ? 3.4 : (isExtremes ? 2.5 : 1.5);
    const opacity = s.franchise === bestAtCursor.franchise || isExtremes ? 1 : 0.55;
    const ptsAttr = s.points.map(pt => `${scaleX(pt.x).toFixed(1)},${scaleY(pt.y).toFixed(1)}`).join(" ");
    svgParts.push(
      `<polyline fill="none" stroke="${s.color}" stroke-width="${strokeW}" stroke-opacity="${opacity}" points="${ptsAttr}" />`
    );
  }

  const curX = scaleX(state.medicalCost);
  svgParts.push(`<line x1="${curX}" y1="${padT}" x2="${curX}" y2="${H - padB}" stroke="${CHART_THEME.cursor}" stroke-width="1.8" />`);

  for (const s of seriesList) {
    const cy = scaleY(s.cursorTotal);
    const r = s.franchise === bestAtCursor.franchise ? 6 : 4;
    svgParts.push(`<circle cx="${curX}" cy="${cy}" r="${r}" fill="${s.color}" stroke="${CHART_THEME.pointStroke}" stroke-width="1.5" />`);
  }

  svg.innerHTML = svgParts.join("");

  const bdEl = document.getElementById("cursor-breakdown");
  bdEl.innerHTML = seriesList.map(s => {
    const isBest = s.franchise === bestAtCursor.franchise;
    return `
      <div class="cb-item ${isBest ? "best" : ""}">
        <div class="cb-head">
          <span class="legend-dot" style="background:${s.color}"></span>
          <span>${dict.franchiseTag(s.franchise)} ${isBest ? dict.cbBestTag : ""}</span>
        </div>
        <div class="cb-total">CHF ${fmtChf(s.cursorTotal, 0)}</div>
        <div class="cb-sub">${dict.cbSubText(s.netYearly, s.cursorOop)}</div>
      </div>
    `;
  }).join("");
}
