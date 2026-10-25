export function fmtChf(num, decimals = 2) {
  if (num === null || num === undefined || isNaN(num)) return "—";
  const fixed = Number(num).toFixed(decimals);
  const parts = fixed.split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return parts.join(".");
}

export function fmtSignedPct(val, decimals = 1) {
  if (val === null || val === undefined || isNaN(val)) return "—";
  const num = Number(val);
  const sign = num > 0 ? "+" : "";
  return `${sign}${num.toFixed(decimals)}%`;
}

// Escape upstream strings before they are interpolated into innerHTML
export function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function getTrendBadgeHtml(pct) {
  if (pct === null || pct === undefined || isNaN(pct)) return `<span class="trend-badge">—</span>`;
  let cls = "trend-mid";
  if (pct <= 5.2) cls = "trend-low";
  else if (pct >= 6.5) cls = "trend-high";
  return `<span class="trend-badge ${cls}">${fmtSignedPct(pct, 1)}</span>`;
}
