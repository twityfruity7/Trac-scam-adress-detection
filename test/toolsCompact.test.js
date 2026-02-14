import assert from 'node:assert/strict';
import test from 'node:test';

import { INTERCOMSWAP_TOOLS } from '../src/prompt/tools.js';
import { compactToolsForModel } from '../src/prompt/toolsCompact.js';

test('compactToolsForModel significantly reduces tool JSON size', () => {
  const full = JSON.stringify(INTERCOMSWAP_TOOLS);
  const compact = JSON.stringify(compactToolsForModel(INTERCOMSWAP_TOOLS));

  // This test is a guardrail for 32k-context models: the full schema bundle can
  // exceed context limits. We expect compaction to cut the payload meaningfully.
  assert.ok(compact.length < full.length, 'compact must be smaller than full');

  const ratio = compact.length / full.length;
  // Conservative: ensure we cut at least ~35% today. If this fails later, the
  // compaction likely regressed (or the full schemas got much smaller).
  assert.ok(ratio <= 0.65, `expected compact/full <= 0.65, got ${ratio.toFixed(3)}`);
});

