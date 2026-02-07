import test from 'node:test';
import assert from 'node:assert/strict';

import { PriceOracle } from '../src/price/oracle.js';
import { PAIR } from '../src/price/providers.js';

test('price oracle: static providers produce healthy snapshot', async () => {
  const oracle = new PriceOracle({
    providerIds: 'static',
    staticPrices: {
      [PAIR.BTC_USDT]: 200000,
      [PAIR.USDT_USD]: 1,
    },
    staticCount: 5,
    requiredProviders: 5,
    minOk: 2,
    minAgree: 2,
    maxDeviationBps: 10,
    pairs: [PAIR.BTC_USDT, PAIR.USDT_USD],
  });

  const snap = await oracle.tick();
  assert.equal(snap.type, 'price_snapshot');
  assert.equal(snap.ok, true);
  assert.equal(snap.providers.length, 5);
  assert.equal(snap.pairs[PAIR.BTC_USDT].ok, true);
  assert.equal(snap.pairs[PAIR.BTC_USDT].median, 200000);
  assert.equal(snap.pairs[PAIR.USDT_USD].ok, true);
  assert.equal(snap.pairs[PAIR.USDT_USD].median, 1);
});

test('price oracle: detects misconfiguration when too few providers are configured', async () => {
  const oracle = new PriceOracle({
    providerIds: 'static',
    staticPrices: { [PAIR.BTC_USDT]: 200000 },
    staticCount: 2,
    requiredProviders: 5,
    minOk: 2,
    minAgree: 2,
    pairs: [PAIR.BTC_USDT],
  });

  const snap = await oracle.tick();
  assert.equal(snap.ok, false);
  assert.equal(snap.pairs[PAIR.BTC_USDT].ok, false);
  assert.match(String(snap.pairs[PAIR.BTC_USDT].error || ''), /misconfigured/);
});

test('price oracle: fails consensus when minAgree cannot be met', async () => {
  const mk = (id, price) => ({
    id,
    supports: new Set([PAIR.BTC_USDT]),
    async fetch() {
      return { ok: true, price, ts: Date.now(), source: id, error: null };
    },
  });

  const providers = new Map([
    ['a', mk('a', 100)],
    ['b', mk('b', 100)],
    ['c', mk('c', 120)],
  ]);

  const oracle = new PriceOracle({
    providers,
    providerIds: ['a', 'b', 'c'],
    requiredProviders: 3,
    minOk: 2,
    minAgree: 3,
    maxDeviationBps: 50,
    pairs: [PAIR.BTC_USDT],
  });

  const snap = await oracle.tick();
  assert.equal(snap.ok, false);
  assert.equal(snap.pairs[PAIR.BTC_USDT].ok, false);
  assert.match(String(snap.pairs[PAIR.BTC_USDT].error || ''), /no consensus|insufficient consensus/);
});

