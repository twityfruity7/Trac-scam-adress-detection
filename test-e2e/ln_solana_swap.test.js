import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
  createAssociatedTokenAccount,
  createMint,
  getAccount,
  getAssociatedTokenAddress,
  mintTo,
} from '@solana/spl-token';

import {
  LN_USDT_ESCROW_PROGRAM_ID,
  claimEscrowTx,
  createEscrowTx,
  deriveEscrowPda,
  getEscrowState,
} from '../src/solana/lnUsdtEscrowClient.js';

const execFileP = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const composeFile = path.join(repoRoot, 'dev/ln-regtest/docker-compose.yml');

async function sh(cmd, args, opts = {}) {
  const { stdout, stderr } = await execFileP(cmd, args, {
    cwd: repoRoot,
    maxBuffer: 1024 * 1024 * 50,
    ...opts,
  });
  return { stdout: String(stdout || ''), stderr: String(stderr || '') };
}

async function dockerCompose(args) {
  return sh('docker', ['compose', '-f', composeFile, ...args]);
}

async function dockerComposeJson(args) {
  const { stdout } = await dockerCompose(args);
  const text = stdout.trim();
  try {
    return JSON.parse(text);
  } catch (_e) {
    throw new Error(`Failed to parse JSON: ${text.slice(0, 200)}`);
  }
}

async function retry(fn, { tries = 50, delayMs = 500, label = 'retry' } = {}) {
  let lastErr = null;
  for (let i = 0; i < tries; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error(`${label} failed after ${tries} tries: ${lastErr?.message ?? String(lastErr)}`);
}

async function btcCli(args) {
  const { stdout } = await dockerCompose([
    'exec',
    '-T',
    'bitcoind',
    'bitcoin-cli',
    '-regtest',
    '-rpcuser=rpcuser',
    '-rpcpassword=rpcpass',
    '-rpcport=18443',
    ...args,
  ]);
  const text = stdout.trim();
  try {
    return JSON.parse(text);
  } catch (_e) {
    return { result: text };
  }
}

async function clnCli(service, args) {
  return dockerComposeJson(['exec', '-T', service, 'lightning-cli', '--network=regtest', ...args]);
}

function parseHex32(value, label) {
  const hex = String(value || '').trim().toLowerCase();
  assert.match(hex, /^[0-9a-f]{64}$/, `${label} must be 32-byte hex`);
  return hex;
}

async function startSolanaValidator({ soPath }) {
  const ledgerPath = path.join(repoRoot, 'onchain/solana/ledger-e2e');
  const url = 'https://api.devnet.solana.com';
  const args = [
    '--reset',
    '--ledger',
    ledgerPath,
    '--bind-address',
    '127.0.0.1',
    '--rpc-port',
    '8899',
    '--faucet-port',
    '9900',
    '--url',
    url,
    '--clone',
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    '--clone',
    'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
    '--bpf-program',
    LN_USDT_ESCROW_PROGRAM_ID.toBase58(),
    soPath,
    '--quiet',
  ];

  const proc = spawn('solana-test-validator', args, {
    cwd: repoRoot,
    env: { ...process.env, COPYFILE_DISABLE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let out = '';
  const append = (chunk) => {
    out += chunk;
    if (out.length > 20000) out = out.slice(-20000);
  };
  proc.stdout.on('data', (d) => append(String(d)));
  proc.stderr.on('data', (d) => append(String(d)));

  const connection = new Connection('http://127.0.0.1:8899', 'confirmed');
  await retry(() => connection.getVersion(), { label: 'solana rpc ready', tries: 120, delayMs: 500 });

  return {
    proc,
    connection,
    tail: () => out,
    stop: async () => {
      proc.kill('SIGINT');
      await new Promise((r) => proc.once('exit', r));
    },
  };
}

test('e2e: LN preimage claims Solana USDT escrow', async (t) => {
  // Ensure our SBF program is built.
  await sh('cargo', ['build-sbf'], { cwd: path.join(repoRoot, 'solana/ln_usdt_escrow') });
  const soPath = path.join(repoRoot, 'solana/ln_usdt_escrow/target/deploy/ln_usdt_escrow.so');

  // Start LN stack.
  await dockerCompose(['up', '-d']);
  t.after(async () => {
    try {
      await dockerCompose(['down', '-v', '--remove-orphans']);
    } catch (_e) {}
  });

  await retry(() => btcCli(['getblockchaininfo']), { label: 'bitcoind ready', tries: 120, delayMs: 500 });
  await retry(() => clnCli('cln-alice', ['getinfo']), { label: 'cln-alice ready', tries: 120, delayMs: 500 });
  await retry(() => clnCli('cln-bob', ['getinfo']), { label: 'cln-bob ready', tries: 120, delayMs: 500 });

  // Create miner wallet and mine spendable coins.
  try {
    await btcCli(['createwallet', 'miner']);
  } catch (_e) {}
  const minerAddr = (await btcCli(['-rpcwallet=miner', 'getnewaddress'])).result;
  await btcCli(['-rpcwallet=miner', 'generatetoaddress', '101', minerAddr]);

  // Fund both LN nodes.
  const aliceBtcAddr = (await clnCli('cln-alice', ['newaddr'])).bech32;
  const bobBtcAddr = (await clnCli('cln-bob', ['newaddr'])).bech32;
  await btcCli(['-rpcwallet=miner', 'sendtoaddress', aliceBtcAddr, '1']);
  await btcCli(['-rpcwallet=miner', 'sendtoaddress', bobBtcAddr, '1']);
  await btcCli(['-rpcwallet=miner', 'generatetoaddress', '6', minerAddr]);

  await retry(async () => {
    const funds = await clnCli('cln-alice', ['listfunds']);
    if (!funds.outputs || funds.outputs.length === 0) throw new Error('alice not funded');
    return funds;
  }, { label: 'alice funded' });
  await retry(async () => {
    const funds = await clnCli('cln-bob', ['listfunds']);
    if (!funds.outputs || funds.outputs.length === 0) throw new Error('bob not funded');
    return funds;
  }, { label: 'bob funded' });

  // Connect and open channel (bob -> alice).
  const aliceInfo = await clnCli('cln-alice', ['getinfo']);
  const aliceNodeId = aliceInfo.id;
  await clnCli('cln-bob', ['connect', `${aliceNodeId}@cln-alice:9735`]);
  await clnCli('cln-bob', ['fundchannel', aliceNodeId, '1000000']); // 0.01 BTC-ish in sats (regtest)
  await btcCli(['-rpcwallet=miner', 'generatetoaddress', '6', minerAddr]);

  await retry(async () => {
    const chans = await clnCli('cln-bob', ['listpeerchannels']);
    const c = chans.channels?.find((x) => x.peer_id === aliceNodeId);
    const st = c?.state || '';
    if (st !== 'CHANNELD_NORMAL') throw new Error(`channel state=${st}`);
    return chans;
  }, { label: 'channel active', tries: 120, delayMs: 500 });

  // Alice creates invoice (normal invoice; no hodl invoices).
  const invoice = await clnCli('cln-alice', ['invoice', '100000msat', 'swap1', 'swap test']);
  const bolt11 = invoice.bolt11;
  const paymentHashHex = parseHex32(invoice.payment_hash, 'payment_hash');

  // Start Solana local validator with our program loaded.
  const sol = await startSolanaValidator({ soPath });
  t.after(async () => {
    try {
      await sol.stop();
    } catch (_e) {}
  });

  const connection = sol.connection;
  const solAlice = Keypair.generate();
  const solBob = Keypair.generate();
  const airdropAlice = await connection.requestAirdrop(solAlice.publicKey, 2_000_000_000);
  await connection.confirmTransaction(airdropAlice, 'confirmed');
  const airdropBob = await connection.requestAirdrop(solBob.publicKey, 2_000_000_000);
  await connection.confirmTransaction(airdropBob, 'confirmed');

  await retry(async () => {
    const bal = await connection.getBalance(solAlice.publicKey, 'confirmed');
    if (bal <= 0) throw new Error('sol alice still has 0 balance');
    return bal;
  }, { label: 'sol alice airdrop' });
  await retry(async () => {
    const bal = await connection.getBalance(solBob.publicKey, 'confirmed');
    if (bal <= 0) throw new Error('sol bob still has 0 balance');
    return bal;
  }, { label: 'sol bob airdrop' });

  const mint = await createMint(connection, solAlice, solAlice.publicKey, null, 6);
  const aliceToken = await createAssociatedTokenAccount(connection, solAlice, mint, solAlice.publicKey);
  const bobToken = await createAssociatedTokenAccount(connection, solAlice, mint, solBob.publicKey);
  await mintTo(connection, solAlice, mint, aliceToken, solAlice, 100_000_000n); // 100 USDT (6 decimals)

  // Create escrow keyed to LN payment_hash.
  const now = Math.floor(Date.now() / 1000);
  const refundAfter = now + 3600;
  const { tx: escrowTx, escrowPda } = await createEscrowTx({
    connection,
    payer: solAlice,
    payerTokenAccount: aliceToken,
    mint,
    paymentHashHex,
    recipient: solBob.publicKey,
    refund: solAlice.publicKey,
    refundAfterUnix: refundAfter,
    amount: 100_000_000n,
  });
  const sig1 = await connection.sendRawTransaction(escrowTx.serialize());
  await connection.confirmTransaction(sig1, 'confirmed');

  const state = await getEscrowState(connection, paymentHashHex);
  assert.ok(state, 'escrow state exists');
  assert.equal(state.status, 0, 'escrow is active');
  assert.equal(state.paymentHashHex, paymentHashHex);
  assert.equal(state.recipient.toBase58(), solBob.publicKey.toBase58());
  assert.equal(state.refund.toBase58(), solAlice.publicKey.toBase58());
  assert.equal(state.amount, 100_000_000n);

  // Bob pays LN invoice and obtains preimage.
  const payRes = await clnCli('cln-bob', ['pay', bolt11]);
  const preimageHex = parseHex32(payRes.payment_preimage, 'payment_preimage');

  // Bob claims escrow using LN preimage.
  const { tx: claimTx } = await claimEscrowTx({
    connection,
    recipient: solBob,
    recipientTokenAccount: bobToken,
    mint,
    paymentHashHex,
    preimageHex,
  });
  const sig2 = await connection.sendRawTransaction(claimTx.serialize());
  await connection.confirmTransaction(sig2, 'confirmed');

  const bobAcc = await getAccount(connection, bobToken, 'confirmed');
  assert.equal(bobAcc.amount, 100_000_000n);

  const afterState = await getEscrowState(connection, paymentHashHex);
  assert.ok(afterState, 'escrow state still exists');
  assert.equal(afterState.status, 1, 'escrow claimed');
  assert.equal(afterState.amount, 0n, 'escrow drained');
});
