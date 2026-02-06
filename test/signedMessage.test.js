import test from 'node:test';
import assert from 'node:assert/strict';
import b4a from 'b4a';
import PeerWallet from 'trac-wallet';
import {
  attachSignature,
  createUnsignedEnvelope,
  encodeEnvelopeForSigning,
  verifySignedEnvelope,
} from '../src/protocol/signedMessage.js';

test('signed envelope verifies with trac-wallet', async () => {
  const wallet = new PeerWallet();
  await wallet.ready;
  await wallet.generateKeyPair();

  const unsigned = createUnsignedEnvelope({
    kind: 'swap_terms',
    tradeId: 'swap_test_1',
    body: { sats: 123, usdt: 456 },
    ts: 123456,
    nonce: 'abc',
  });
  const message = encodeEnvelopeForSigning(unsigned);
  const sigBuf = wallet.sign(b4a.from(message, 'utf8'));
  const signed = attachSignature(unsigned, {
    signerPubKeyHex: b4a.toString(wallet.publicKey, 'hex'),
    sigHex: b4a.toString(sigBuf, 'hex'),
  });

  const res = verifySignedEnvelope(signed);
  assert.equal(res.ok, true);
});

test('signature fails if payload is modified', async () => {
  const wallet = new PeerWallet();
  await wallet.ready;
  await wallet.generateKeyPair();

  const unsigned = createUnsignedEnvelope({
    kind: 'swap_terms',
    tradeId: 'swap_test_2',
    body: { sats: 123, usdt: 456 },
    ts: 123456,
    nonce: 'abc',
  });
  const message = encodeEnvelopeForSigning(unsigned);
  const sigBuf = wallet.sign(b4a.from(message, 'utf8'));
  const signed = attachSignature(unsigned, {
    signerPubKeyHex: b4a.toString(wallet.publicKey, 'hex'),
    sigHex: b4a.toString(sigBuf, 'hex'),
  });

  signed.body.sats = 124;
  const res = verifySignedEnvelope(signed);
  assert.equal(res.ok, false);
});

