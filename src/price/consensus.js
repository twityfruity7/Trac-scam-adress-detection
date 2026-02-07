export function median(values) {
  const list = (values || []).filter((n) => typeof n === 'number' && Number.isFinite(n));
  if (list.length === 0) return null;
  const sorted = list.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function deviationBps(price, ref) {
  const p = Number(price);
  const r = Number(ref);
  if (!Number.isFinite(p) || !Number.isFinite(r) || r <= 0) return null;
  return Math.abs(p - r) / r * 10_000;
}

// points: [{ id, price }]
export function evaluateConsensus({
  points,
  maxDeviationBps = 50,
  minAgree = 2,
} = {}) {
  const okPoints = Array.isArray(points)
    ? points
        .map((p) => ({ id: String(p?.id || '').trim(), price: Number(p?.price) }))
        .filter((p) => p.id && Number.isFinite(p.price) && p.price > 0)
    : [];

  const med = median(okPoints.map((p) => p.price));
  if (med === null) {
    return {
      ok: false,
      median: null,
      agreeing: [],
      outliers: [],
      spread_bps: null,
      error: 'no valid points',
    };
  }

  const agreeing = [];
  const outliers = [];
  for (const p of okPoints) {
    const d = deviationBps(p.price, med);
    if (d === null) continue;
    if (d <= maxDeviationBps) agreeing.push({ ...p, deviation_bps: d });
    else outliers.push({ ...p, deviation_bps: d });
  }

  const agreePrices = agreeing.map((p) => p.price);
  const minP = agreePrices.length > 0 ? Math.min(...agreePrices) : null;
  const maxP = agreePrices.length > 0 ? Math.max(...agreePrices) : null;
  const spreadBps = minP !== null && maxP !== null ? deviationBps(maxP, minP) : null;

  if (agreeing.length < minAgree) {
    return {
      ok: false,
      median: med,
      agreeing,
      outliers,
      spread_bps: spreadBps,
      error: `insufficient consensus (agreeing=${agreeing.length} minAgree=${minAgree})`,
    };
  }

  return {
    ok: true,
    median: med,
    agreeing,
    outliers,
    spread_bps: spreadBps,
    error: null,
  };
}

