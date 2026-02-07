import { evaluateConsensus } from './consensus.js';
import { createDefaultProviders, PAIR } from './providers.js';

const nowMs = () => Date.now();

function cloneJson(v) {
  return JSON.parse(JSON.stringify(v));
}

function parseCsv(raw) {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function staticProvider(id, pricesByPair) {
  const supports = Object.keys(pricesByPair);
  return {
    id,
    supports: new Set(supports),
    async fetch(pair) {
      if (!this.supports.has(pair)) return null;
      const price = Number(pricesByPair[pair]);
      if (!Number.isFinite(price) || price <= 0) {
        return { ok: false, price: null, ts: nowMs(), source: id, error: 'invalid static price' };
      }
      return { ok: true, price, ts: nowMs(), source: id, error: null };
    },
  };
}

export class PriceOracle {
  constructor({
    providers = null,
    providerIds = null,
    pairs = [PAIR.BTC_USDT, PAIR.USDT_USD],
    requiredProviders = 5,
    minOk = 2,
    minAgree = 2,
    maxDeviationBps = 50,
    timeoutMs = 4000,
    staticPrices = null, // { BTC_USDT: number, USDT_USD: number }
    staticCount = 5,
  } = {}) {
    this.pairs = Array.isArray(pairs) ? pairs.slice() : [PAIR.BTC_USDT, PAIR.USDT_USD];
    this.requiredProviders = Number.isFinite(requiredProviders) ? Math.max(1, Math.trunc(requiredProviders)) : 5;
    this.minOk = Number.isFinite(minOk) ? Math.max(1, Math.trunc(minOk)) : 2;
    this.minAgree = Number.isFinite(minAgree) ? Math.max(1, Math.trunc(minAgree)) : 2;
    this.maxDeviationBps = Number.isFinite(maxDeviationBps) ? Math.max(0, Number(maxDeviationBps)) : 50;
    this.timeoutMs = Number.isFinite(timeoutMs) ? Math.max(250, Math.trunc(timeoutMs)) : 4000;

    // Build provider list.
    const providerMap = providers instanceof Map ? providers : createDefaultProviders();
    const ids = providerIds
      ? Array.isArray(providerIds)
        ? providerIds.map((v) => String(v).trim()).filter(Boolean)
        : parseCsv(providerIds)
      : [
          // Reasonable default set (>= 5).
          'binance',
          'coinbase',
          'gate',
          'kucoin',
          'okx',
          'bitstamp',
          'kraken',
        ];

    const out = [];
    for (const idRaw of ids) {
      const id = String(idRaw).trim().toLowerCase();
      if (!id) continue;
      if (id === 'static') {
        const prices = staticPrices && typeof staticPrices === 'object' ? staticPrices : {};
        const btcUsdt = Number(prices[PAIR.BTC_USDT]);
        const usdtUsd = Number(prices[PAIR.USDT_USD]);
        const priceMap = {};
        if (Number.isFinite(btcUsdt) && btcUsdt > 0) priceMap[PAIR.BTC_USDT] = btcUsdt;
        if (Number.isFinite(usdtUsd) && usdtUsd > 0) priceMap[PAIR.USDT_USD] = usdtUsd;
        const n = Number.isFinite(staticCount) ? Math.max(1, Math.trunc(staticCount)) : 5;
        for (let i = 0; i < n; i += 1) out.push(staticProvider(`static${i + 1}`, priceMap));
        continue;
      }
      const p = providerMap.get(id);
      if (!p) throw new Error(`Unknown price provider: ${id}`);
      out.push(p);
    }

    this.providers = out;
  }

  async tick() {
    const ts = nowMs();
    const configuredProviders = this.providers.map((p) => p.id);
    const misconfigured = configuredProviders.length < this.requiredProviders;

    const pairs = {};
    let allOk = true;

    for (const pair of this.pairs) {
      const pending = [];
      for (const p of this.providers) {
        if (!p?.supports?.has?.(pair)) continue;
        pending.push(
          p
            .fetch(pair, { timeoutMs: this.timeoutMs })
            .then((r) => ({ id: p.id, result: r }))
            .catch((e) => ({ id: p.id, result: { ok: false, price: null, ts: nowMs(), source: p.id, error: e?.message ?? String(e) } }))
        );
      }

      const settled = await Promise.all(pending);
      const results = settled
        .map((x) => ({ id: x.id, ...x.result }))
        .filter((x) => x && typeof x === 'object');

      const okPoints = results.filter((r) => r.ok).map((r) => ({ id: r.id, price: r.price }));
      const consensus = evaluateConsensus({
        points: okPoints,
        maxDeviationBps: this.maxDeviationBps,
        minAgree: this.minAgree,
      });

      let feedOk = true;
      let error = null;
      if (misconfigured) {
        feedOk = false;
        error = `misconfigured (providers=${configuredProviders.length} required=${this.requiredProviders})`;
      } else if (okPoints.length < this.minOk) {
        feedOk = false;
        error = `insufficient sources (ok=${okPoints.length} minOk=${this.minOk})`;
      } else if (!consensus.ok) {
        feedOk = false;
        error = consensus.error || 'no consensus';
      }

      if (!feedOk) allOk = false;

      pairs[pair] = {
        ok: feedOk,
        error,
        median: consensus.median,
        agreeing: consensus.agreeing.map((p) => p.id),
        outliers: consensus.outliers.map((p) => p.id),
        spread_bps: consensus.spread_bps,
        ok_sources: okPoints.length,
        sources: results,
        max_deviation_bps: this.maxDeviationBps,
        min_ok: this.minOk,
        min_agree: this.minAgree,
        required_providers: this.requiredProviders,
        providers_configured: configuredProviders.length,
      };
    }

    return {
      type: 'price_snapshot',
      ts,
      ok: allOk,
      providers: configuredProviders,
      pairs,
    };
  }

  // Convenience: JSON-serializable clone to avoid callers mutating internal state.
  static cloneSnapshot(snapshot) {
    return snapshot ? cloneJson(snapshot) : null;
  }
}

