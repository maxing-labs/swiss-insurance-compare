// /api endpoints. Non-2xx responses throw; aborting via `signal` rejects with AbortError.
// Superseded-request handling (sequence numbers, AbortController) stays with the callers.

async function getJson(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function fetchLocations() {
  return getJson("/api/locations");
}

export function fetchFranchises(yob, signal) {
  return getJson(`/api/franchises?yob=${encodeURIComponent(yob)}`, signal);
}

export function fetchCalculation({ locationId, yob, franchise, coverage, models }, signal) {
  const params = new URLSearchParams({
    location_id: locationId,
    yob: String(yob),
    franchise: String(franchise),
    coverage: String(coverage),
    models: models.join(",")
  });
  return getJson(`/api/calculate?${params.toString()}`, signal);
}
