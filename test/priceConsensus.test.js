import test from 'node:test';
import assert from 'node:assert/strict';

import { deviationBps, evaluateConsensus, median } from '../src/price/consensus.js';

test('price consensus: median()', () => {
  assert.equal(median([]), null);
  assert.equal(median([1]), 1);
  assert.equal(median([1, 2]), 1.5);
  assert.equal(median([3, 1, 2]), 2);
});

test('price consensus: deviationBps()', () => {
  assert.equal(deviationBps(101, 100), 100);
  assert.equal(deviationBps(99, 100), 100);
  assert.equal(deviationBps(100, 0), null);
});

test('price consensus: evaluateConsensus() rejects no points', () => {
  const r = evaluateConsensus({ points: [], maxDeviationBps: 50, minAgree: 2 });
  assert.equal(r.ok, false);
  assert.equal(r.median, null);
});

test('price consensus: evaluateConsensus() filters outliers', () => {
  const r = evaluateConsensus({
    points: [
      { id: 'a', price: 100 },
      { id: 'b', price: 100.2 },
      { id: 'c', price: 110 },
    ],
    maxDeviationBps: 50, // 0.50%
    minAgree: 2,
  });
  assert.equal(r.ok, true);
  assert.equal(r.outliers.length, 1);
  assert.equal(r.outliers[0].id, 'c');
  assert.equal(r.agreeing.length, 2);
});

test('price consensus: evaluateConsensus() enforces minAgree', () => {
  const r = evaluateConsensus({
    points: [
      { id: 'a', price: 100 },
      { id: 'b', price: 100.2 },
      { id: 'c', price: 110 },
    ],
    maxDeviationBps: 50,
    minAgree: 3,
  });
  assert.equal(r.ok, false);
  assert.match(String(r.error || ''), /insufficient consensus/);
});

