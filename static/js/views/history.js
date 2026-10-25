import { I18N } from "../i18n/index.js";
import { fmtChf, fmtSignedPct, esc, getTrendBadgeHtml } from "../format.js";
import { state } from "../state.js";

const HISTORY_LINE_COLORS = [
  "#dc2626", "#2563eb", "#059669", "#d97706",
  "#7c3aed", "#0891b2", "#be185d", "#4b5563"
];

function renderHistoryChart(rows, years) {
  const svg = document.getElementById("history-svg");
  const legendEl = document.getElementById("history-chart-legend");
  if (!svg || !legendEl || !years.length || !rows.length) return;

  const topRows = rows
    .filter(r => years.some(y => r.history?.[y]?.premium !== null && r.history?.[y]?.premium !== undefined))
    .slice(0, 8);

  if (topRows.length === 0) {
    svg.innerHTML = "";
    legendEl.innerHTML = "";
    return;
  }

  let minP = Infinity;
  let maxP = -Infinity;
  for (const r of topRows) {
    for (const y of years) {
      const p = r.history?.[y]?.premium;
      if (p !== null && p !== undefined) {
        if (p < minP) minP = p;
        if (p > maxP) maxP = p;
      }
    }
  }
  minP = Math.floor(minP / 20) * 20 - 10;
  maxP = Math.ceil(maxP / 20) * 20 + 10;
  if (maxP <= minP) maxP = minP + 100;

  const W = 820, H = 300;
  const padL = 68, padR = 28, padT = 20, padB = 38;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const scaleX = (idx) => padL + (years.length > 1 ? (idx / (years.length - 1)) * plotW : plotW / 2);
  const scaleY = (val) => padT + plotH - ((val - minP) / (maxP - minP)) * plotH;

  const parts = [];
  const yTicks = 4;
  for (let i = 0; i <= yTicks; i++) {
    const val = minP + ((maxP - minP) * i) / yTicks;
    const py = scaleY(val);
    parts.push(`<line x1="${padL}" y1="${py}" x2="${W - padR}" y2="${py}" stroke="#e5e7eb" stroke-width="1" />`);
    parts.push(`<text x="${padL - 8}" y="${py + 4}" text-anchor="end" font-size="12" fill="#4b5563">${fmtChf(val, 0)}</text>`);
  }

  years.forEach((y, idx) => {
    const px = scaleX(idx);
    parts.push(`<line x1="${px}" y1="${padT}" x2="${px}" y2="${H - padB}" stroke="#e5e7eb" stroke-width="1" />`);
    parts.push(`<text x="${px}" y="${H - padB + 20}" text-anchor="middle" font-size="12" font-weight="600" fill="#4b5563">${y}</text>`);
  });

  topRows.forEach((r, rIdx) => {
    const color = HISTORY_LINE_COLORS[rIdx % HISTORY_LINE_COLORS.length];
    const pts = [];
    years.forEach((y, yIdx) => {
      const p = r.history?.[y]?.premium;
      if (p !== null && p !== undefined) {
        pts.push({ x: scaleX(yIdx), y: scaleY(p) });
      }
    });
    if (pts.length > 1) {
      parts.push(`<polyline fill="none" stroke="${color}" stroke-width="2.4" points="${pts.map(pt => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(" ")}" />`);
    }
    for (const pt of pts) {
      parts.push(`<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="3.5" fill="${color}" stroke="#fff" stroke-width="1.2" />`);
    }
  });

  svg.innerHTML = parts.join("");
  legendEl.innerHTML = topRows.map((r, rIdx) => {
    const color = HISTORY_LINE_COLORS[rIdx % HISTORY_LINE_COLORS.length];
    return `
      <span class="legend-item">
        <span class="legend-dot" style="background:${color}"></span>
        <span>${esc(r.insurer)} (${fmtSignedPct(r.avgIncreasePct)})</span>
      </span>
    `;
  }).join("");
}

export function renderHistoryTable(historyRows, years) {
  const dict = I18N[state.lang] || I18N.zh;
  const thead = document.getElementById("history-thead");
  const tbody = document.getElementById("history-tbody");

  const q = state.searchQuery.trim().toLowerCase();
  const rows = historyRows.filter(r => !q || r.insurer.toLowerCase().includes(q));
  rows.sort((a, b) => (a.avgIncreasePct ?? 99) - (b.avgIncreasePct ?? 99));

  renderHistoryChart(rows, years);

  thead.innerHTML = `
    <tr>
      <th scope="col">${dict.thInsurer}</th>
      ${years.map(y => `<th scope="col" class="num-col">${y}</th>`).join("")}
      <th scope="col" class="num-col">${dict.th5YrAvg}</th>
    </tr>
  `;

  tbody.innerHTML = rows.map(r => {
    const yearCells = years.map(y => {
      const item = r.history?.[y];
      if (!item || item.premium === null) return `<td class="num-col" data-label="${y}">—</td>`;
      const pctColor = item.changePct > 6.5
        ? "var(--red-bad)"
        : (item.changePct < 0 ? "var(--green-good)" : "var(--text-muted)");
      const pctHtml = item.changePct !== null && item.changePct !== undefined
        ? `<div style="font-size:0.7rem;color:${pctColor}">${fmtSignedPct(item.changePct, 1)}</div>`
        : "";
      return `<td class="num-col" data-label="${y}"><div><strong>${fmtChf(item.premium)}</strong></div>${pctHtml}</td>`;
    }).join("");

    return `
      <tr>
        <th scope="row">${esc(r.insurer)}</th>
        ${yearCells}
        <td class="num-col" data-label="${dict.th5YrAvg}">${getTrendBadgeHtml(r.avgIncreasePct)}</td>
      </tr>
    `;
  }).join("");
}
