import { I18N } from "../i18n/index.js";
import { fmtChf, esc } from "../format.js";
import { calcOutOfPocket } from "../calc.js";
import { state, filterAndSortPlans } from "../state.js";

export function renderMatrixTable(plans, franchises, rebate, isKid) {
  const dict = I18N[state.lang] || I18N.zh;
  const thead = document.getElementById("matrix-thead");
  const tbody = document.getElementById("matrix-tbody");
  const filtered = filterAndSortPlans(plans);

  thead.innerHTML = `
    <tr>
      <th scope="col">${dict.thInsurer}</th>
      <th scope="col">${dict.thModel}</th>
      ${franchises.map(f => `<th scope="col" class="num-col">F ${fmtChf(f, 0)}</th>`).join("")}
    </tr>
  `;

  tbody.innerHTML = filtered.map(p => {
    const cells = franchises.map(f => {
      const grossMonthly = p.matrixPrices?.[String(f)];
      if (grossMonthly === null || grossMonthly === undefined) {
        return `<td class="num-col" data-label="F ${f}">—</td>`;
      }
      const isBest = f === p.bestFranchiseForPlan;
      const cls = isBest ? "num-col cell-best-franchise" : "num-col";

      if (state.matrixMode === "monthly") {
        const netMonthly = Math.max(0, grossMonthly - rebate);
        return `<td class="${cls}" data-label="F ${f}">${fmtChf(netMonthly)}</td>`;
      } else {
        const netYearly = Math.max(0, (grossMonthly - rebate) * 12);
        const oop = calcOutOfPocket(state.medicalCost, f, isKid);
        return `<td class="${cls}" data-label="F ${f}">${fmtChf(netYearly + oop, 0)}</td>`;
      }
    }).join("");

    return `
      <tr class="matrix-row" data-plan-idx="${p.originalIdx}" style="cursor:pointer;" title="${dict.matrixRowTip}">
        <th scope="row">${esc(p.insurer)}</th>
        <td data-label="${dict.thModel}">${esc(p.model)}</td>
        ${cells}
      </tr>
    `;
  }).join("");
}
