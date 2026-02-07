import { fetchJson } from './request.js';

const nowMs = () => Date.now();

const toNum = (v) => {
  const n = typeof v === 'number' ? v : Number(String(v || '').trim());
  return Number.isFinite(n) ? n : null;
};

const mid = (bid, ask, last = null) => {
  const b = toNum(bid);
  const a = toNum(ask);
  if (b !== null && a !== null && b > 0 && a > 0) return (b + a) / 2;
  const l = toNum(last);
  if (l !== null && l > 0) return l;
  return null;
};

function ok(price, source) {
  return { ok: true, price, ts: nowMs(), source, error: null };
}

function bad(err, source) {
  return { ok: false, price: null, ts: nowMs(), source, error: err?.message ?? String(err) };
}

function provider(id, { supports, fetcher }) {
  return {
    id,
    supports: new Set(supports),
    async fetch(pair, { timeoutMs = 4000 } = {}) {
      if (!this.supports.has(pair)) return null;
      try {
        const price = await fetcher(pair, { timeoutMs });
        if (!Number.isFinite(price) || price <= 0) throw new Error('invalid price');
        return ok(price, id);
      } catch (err) {
        return bad(err, id);
      }
    },
  };
}

export const PAIR = Object.freeze({
  BTC_USDT: 'BTC_USDT',
  USDT_USD: 'USDT_USD',
});

export function createDefaultProviders() {
  const providers = new Map();

  providers.set(
    'binance',
    provider('binance', {
      supports: [PAIR.BTC_USDT],
      fetcher: async (_pair, { timeoutMs }) => {
        const j = await fetchJson('https://api.binance.com/api/v3/ticker/bookTicker?symbol=BTCUSDT', { timeoutMs });
        const p = mid(j?.bidPrice, j?.askPrice, j?.lastPrice);
        if (p === null) throw new Error('missing bid/ask');
        return p;
      },
    })
  );

  providers.set(
    'coinbase',
    provider('coinbase', {
      supports: [PAIR.BTC_USDT, PAIR.USDT_USD],
      fetcher: async (pair, { timeoutMs }) => {
        const url =
          pair === PAIR.BTC_USDT
            ? 'https://api.exchange.coinbase.com/products/BTC-USDT/ticker'
            : 'https://api.exchange.coinbase.com/products/USDT-USD/ticker';
        const j = await fetchJson(url, { timeoutMs });
        const p = mid(j?.bid, j?.ask, j?.price);
        if (p === null) throw new Error('missing bid/ask');
        return p;
      },
    })
  );

  providers.set(
    'gate',
    provider('gate', {
      supports: [PAIR.BTC_USDT, PAIR.USDT_USD],
      fetcher: async (pair, { timeoutMs }) => {
        const currencyPair = pair === PAIR.BTC_USDT ? 'BTC_USDT' : 'USDT_USD';
        const url = `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${encodeURIComponent(currencyPair)}`;
        const j = await fetchJson(url, { timeoutMs });
        const row = Array.isArray(j) ? j[0] : null;
        const p = mid(row?.highest_bid, row?.lowest_ask, row?.last);
        if (p === null) throw new Error('missing bid/ask');
        return p;
      },
    })
  );

  providers.set(
    'kucoin',
    provider('kucoin', {
      supports: [PAIR.BTC_USDT],
      fetcher: async (_pair, { timeoutMs }) => {
        const j = await fetchJson('https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=BTC-USDT', { timeoutMs });
        const p = mid(j?.data?.bestBid, j?.data?.bestAsk, j?.data?.price);
        if (p === null) throw new Error('missing bid/ask');
        return p;
      },
    })
  );

  providers.set(
    'okx',
    provider('okx', {
      supports: [PAIR.BTC_USDT, PAIR.USDT_USD],
      fetcher: async (pair, { timeoutMs }) => {
        const instId = pair === PAIR.BTC_USDT ? 'BTC-USDT' : 'USDT-USD';
        const j = await fetchJson(`https://www.okx.com/api/v5/market/ticker?instId=${encodeURIComponent(instId)}`, { timeoutMs });
        const row = Array.isArray(j?.data) ? j.data[0] : null;
        const p = mid(row?.bidPx, row?.askPx, row?.last);
        if (p === null) throw new Error('missing bid/ask');
        return p;
      },
    })
  );

  providers.set(
    'bitstamp',
    provider('bitstamp', {
      supports: [PAIR.BTC_USDT, PAIR.USDT_USD],
      fetcher: async (pair, { timeoutMs }) => {
        const path = pair === PAIR.BTC_USDT ? 'btcusdt' : 'usdtusd';
        const j = await fetchJson(`https://www.bitstamp.net/api/v2/ticker/${path}/`, { timeoutMs });
        const p = mid(j?.bid, j?.ask, j?.last);
        if (p === null) throw new Error('missing bid/ask');
        return p;
      },
    })
  );

  providers.set(
    'kraken',
    provider('kraken', {
      supports: [PAIR.BTC_USDT, PAIR.USDT_USD],
      fetcher: async (pair, { timeoutMs }) => {
        // Kraken uses XBT for BTC.
        const pairCode = pair === PAIR.BTC_USDT ? 'XBTUSDT' : 'USDTUSD';
        const j = await fetchJson(`https://api.kraken.com/0/public/Ticker?pair=${encodeURIComponent(pairCode)}`, { timeoutMs });
        const result = j?.result && typeof j.result === 'object' ? j.result : null;
        const key = result ? Object.keys(result)[0] : null;
        const row = key ? result[key] : null;
        const p = mid(row?.b?.[0], row?.a?.[0], row?.c?.[0]);
        if (p === null) throw new Error('missing bid/ask');
        return p;
      },
    })
  );

  providers.set(
    'bybit',
    provider('bybit', {
      supports: [PAIR.BTC_USDT],
      fetcher: async (_pair, { timeoutMs }) => {
        const j = await fetchJson('https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT', { timeoutMs });
        const row = Array.isArray(j?.result?.list) ? j.result.list[0] : null;
        const p = mid(row?.bid1Price, row?.ask1Price, row?.lastPrice);
        if (p === null) throw new Error('missing bid/ask');
        return p;
      },
    })
  );

  providers.set(
    'mexc',
    provider('mexc', {
      supports: [PAIR.BTC_USDT],
      fetcher: async (_pair, { timeoutMs }) => {
        const j = await fetchJson('https://api.mexc.com/api/v3/ticker/bookTicker?symbol=BTCUSDT', { timeoutMs });
        const p = mid(j?.bidPrice, j?.askPrice, j?.lastPrice);
        if (p === null) throw new Error('missing bid/ask');
        return p;
      },
    })
  );

  return providers;
}

