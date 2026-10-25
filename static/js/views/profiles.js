import { I18N } from "../i18n/index.js";
import { fmtChf, esc } from "../format.js";
import { familyBundleTop5 } from "../calc.js";
import { state } from "../state.js";

export function buildProfileLabel(locationName, yob, franchise, coverage) {
  const dict = I18N[state.lang] || I18N.zh;
  const cityShort = (locationName || "").split(",")[0].trim();
  const accTag = coverage ? dict.accSuffix : "";
  return `${cityShort} · ${yob} · F${franchise}${accTag}`;
}

export function renderProfileChipsAndCards() {
  const dict = I18N[state.lang] || I18N.zh;
  const chipsEl = document.getElementById("profile-chips");
  const boxEl = document.getElementById("saved-comparison-box");
  const gridEl = document.getElementById("saved-cards-grid");
  const famBox = document.getElementById("family-bundle-box");

  chipsEl.innerHTML = state.savedProfiles.map(p => {
    const isActive = p.id === state.activeProfileId;
    const activeCls = isActive ? "p-chip active" : "p-chip";
    const lbl = buildProfileLabel(p.locationName, p.yob, p.franchise, p.coverage);
    const priceTxt = p.summaryMinMonthly ? ` · CHF ${fmtChf(p.summaryMinMonthly, 0)}` : "";
    return `
      <div class="${activeCls}" data-pid="${p.id}">
        <span>${esc(lbl)}${priceTxt}</span>
        <button type="button" class="p-chip-del" data-del="${p.id}" title="${dict.delProfileTitle}">✕</button>
      </div>
    `;
  }).join("");

  if (state.savedProfiles.length === 0) {
    boxEl.classList.add("hidden");
    return;
  }
  boxEl.classList.remove("hidden");

  gridEl.innerHTML = state.savedProfiles.map(p => {
    const isActive = p.id === state.activeProfileId;
    const activeCls = isActive ? "saved-card active" : "saved-card";
    const lbl = buildProfileLabel(p.locationName, p.yob, p.franchise, p.coverage);
    const minTxt = p.summaryMinMonthly
      ? `CHF ${fmtChf(p.summaryMinMonthly)} ${dict.perMonth}`
      : dict.clickToLoadPrice;
    const yearlyTxt = p.summaryMinMonthly
      ? `${dict.netAnnualPrefix} ${fmtChf(p.summaryMinMonthly * 12, 0)} · ${esc(p.summaryBestPlan || "")}`
      : dict.notCachedYet;
    return `
      <div class="${activeCls}" data-pid="${p.id}">
        <div class="saved-card-head">
          <span>${esc(lbl)}</span>
          <span>${isActive ? dict.activeProfileBadge : dict.switchProfileBadge}</span>
        </div>
        <div class="saved-card-price">${minTxt}</div>
        <div class="saved-card-sub">${yearlyTxt}</div>
      </div>
    `;
  }).join("");

  // Render Family Bundle Same-Insurer Totals when >= 2 profiles have insurerMinMap
  const top5 = familyBundleTop5(state.savedProfiles);
  if (top5.length > 0) {
    famBox.classList.remove("hidden");
    famBox.innerHTML = `
      <div class="family-bundle-title">${dict.familyBundleTitle}</div>
      <div class="family-bundle-chips">
        ${top5.map((item, idx) => `
          <span class="fb-pill ${idx === 0 ? "best" : ""}">
            ${idx === 0 ? "★ " : `${idx + 1}. `}${esc(item.insurer)}: CHF ${fmtChf(item.totalMonthly)}${dict.perMonthShort} (CHF ${fmtChf(item.totalYearly, 0)}/yr)
          </span>
        `).join("")}
      </div>
    `;
  } else {
    famBox.classList.add("hidden");
  }
}
