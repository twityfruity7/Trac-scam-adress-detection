import test from 'node:test';
import assert from 'node:assert/strict';
import { stableStringify } from '../src/util/stableStringify.js';

test('stableStringify produces deterministic key order', () => {
  const a = { b: 1, a: 2, c: { z: 1, y: 2 } };
  const b = { c: { y: 2, z: 1 }, a: 2, b: 1 };
  assert.equal(stableStringify(a), stableStringify(b));
  assert.equal(stableStringify(a), '{"a":2,"b":1,"c":{"y":2,"z":1}}');
});

