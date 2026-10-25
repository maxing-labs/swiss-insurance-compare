import { I18N } from "../i18n/index.js";
import { state, getPremiumYear } from "../state.js";

export function getAgeTagText(yob) {
  const dict = I18N[state.lang] || I18N.en;
  const age = Math.max(0, getPremiumYear() - Number(yob));
  if (age <= 18) return dict.ageChild(age);
  if (age <= 25) return dict.ageYouth(age);
  return dict.ageAdult(age);
}

export function syncFormControlsFromState() {
  document.getElementById("location-search").value = state.locationName;
  const yobInput = document.getElementById("yob-input");
  yobInput.value = state.yob;
  yobInput.classList.remove("is-invalid");
  document.getElementById("yob-error").classList.remove("visible");

  document.getElementById("franchise-select").value = String(state.franchise);

  document.querySelectorAll('input[name="coverage"]').forEach(r => {
    r.checked = Number(r.value) === state.coverage;
  });

  document.querySelectorAll("#model-pills .m-chip").forEach(chip => {
    const cb = chip.querySelector("input");
    cb.checked = state.models.includes(cb.value);
    chip.classList.toggle("active", cb.checked);
  });

  document.getElementById("medical-cost-slider").value = String(state.medicalCost);
  renderMedicalQuickSelect();
  updateMobileCollapseLabel();
}

export function renderMedicalQuickSelect() {
  const dict = I18N[state.lang] || I18N.en;
  const sel = document.getElementById("medical-quick-select");
  if (!sel) return;

  const standardCosts = [
    { val: 0, text: dict.medOpt0 },
    { val: 500, text: dict.medOpt500 },
    { val: 1500, text: dict.medOpt1500 },
    { val: 1900, text: dict.medOptBreakEven },
    { val: 3000, text: dict.medOpt3000 },
    { val: 5000, text: dict.medOpt5000 }
  ];

  const hasExact = standardCosts.some(x => x.val === Number(state.medicalCost));
  if (!hasExact) {
    standardCosts.push({
      val: Number(state.medicalCost),
      text: dict.medOptCustom(state.medicalCost)
    });
    standardCosts.sort((a, b) => a.val - b.val);
  }

  sel.innerHTML = standardCosts
    .map(opt => `<option value="${opt.val}">${opt.text}</option>`)
    .join("");
  sel.value = String(state.medicalCost);
}

export function updateMobileCollapseLabel() {
  const dict = I18N[state.lang] || I18N.en;
  const span = document.getElementById("mobile-filter-summary");
  const btn = document.getElementById("btn-toggle-filters");
  if (!span || !btn) return;
  if (state.mobileFiltersCollapsed) {
    const shortCity = (state.locationName || "").split(" ")[0];
    span.textContent = `${shortCity} · ${state.yob} · F${state.franchise} · ${dict.mobileCollapseClosed}`;
    btn.setAttribute("aria-expanded", "false");
  } else {
    span.textContent = dict.mobileCollapseOpen;
    btn.setAttribute("aria-expanded", "true");
  }
}
