import test from 'node:test';
import assert from 'node:assert/strict';

import { ToolExecutor } from '../src/prompt/executor.js';

test('tool executor: autopost_start accepts arguments alias for nested args (direct tool call compatibility)', async () => {
  const ex = new ToolExecutor({
    scBridge: { url: 'ws://127.0.0.1:0', token: '' },
    peer: { keypairPath: '' },
    ln: {},
    solana: {},
    receipts: { dbPath: '' },
  });

  const out = await ex.execute(
    'intercomswap_autopost_start',
    {
      name: 'rfq_job',
      tool: 'intercomswap_rfq_post',
      interval_sec: 10,
      ttl_sec: 60,
      // Common model mistake: uses "arguments" instead of "args".
      arguments: { channel: '0000intercomswapbtcusdt', trade_id: 'rfq-1', btc_sats: 1002, usdt_amount: '0.33' },
    },
    { autoApprove: true, dryRun: true }
  );

  assert.equal(out.type, 'dry_run');
  assert.equal(out.tool, 'intercomswap_autopost_start');
  assert.equal(out.tool_name, 'intercomswap_rfq_post');
  assert.ok(out.args && typeof out.args === 'object');
  assert.equal(out.args.btc_sats, 1002);
  // rfq_post repairs decimals to atomic USDT.
  assert.equal(out.args.usdt_amount, '330000');
});

