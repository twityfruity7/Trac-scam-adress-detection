import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from '@solana/spl-token';

export const LN_USDT_ESCROW_PROGRAM_ID = new PublicKey('evYHPt33hCYHNm7iFHAHXmSkYrEoDnBSv69MHwLfYyK');

const ESCROW_SEED = Buffer.from('escrow');

function hexToBytes(hex) {
  const h = String(hex || '').trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(h) || h.length % 2 !== 0) {
    throw new Error('Invalid hex');
  }
  return Buffer.from(h, 'hex');
}

function u64Le(n) {
  const x = BigInt(n);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(x);
  return buf;
}

function i64Le(n) {
  const x = BigInt(n);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(x);
  return buf;
}

export function deriveEscrowPda(paymentHashHex, programId = LN_USDT_ESCROW_PROGRAM_ID) {
  const hash = hexToBytes(paymentHashHex);
  if (hash.length !== 32) throw new Error('paymentHash must be 32 bytes');
  const [pda, bump] = PublicKey.findProgramAddressSync([ESCROW_SEED, hash], programId);
  return { pda, bump };
}

export async function deriveVaultAta(escrowPda, mint) {
  return getAssociatedTokenAddress(mint, escrowPda, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
}

export function buildInitInstruction({
  paymentHashHex,
  recipient,
  refund,
  refundAfterUnix,
  amount,
  payer,
  payerTokenAccount,
  mint,
  programId = LN_USDT_ESCROW_PROGRAM_ID,
}) {
  const { pda: escrowPda } = deriveEscrowPda(paymentHashHex, programId);
  const paymentHash = hexToBytes(paymentHashHex);
  const data = Buffer.concat([
    Buffer.from([0]), // Init tag
    paymentHash,
    Buffer.from(recipient.toBytes()),
    Buffer.from(refund.toBytes()),
    i64Le(refundAfterUnix),
    u64Le(amount),
  ]);

  return (vault) =>
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: payerTokenAccount, isSigner: false, isWritable: true },
        { pubkey: escrowPda, isSigner: false, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data,
    });
}

export function buildClaimInstruction({
  preimageHex,
  paymentHashHex,
  recipient,
  recipientTokenAccount,
  mint,
  programId = LN_USDT_ESCROW_PROGRAM_ID,
}) {
  const { pda: escrowPda } = deriveEscrowPda(paymentHashHex, programId);
  const preimage = hexToBytes(preimageHex);
  if (preimage.length !== 32) throw new Error('preimage must be 32 bytes');
  const data = Buffer.concat([Buffer.from([1]), preimage]);

  return (vault) =>
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: recipient, isSigner: true, isWritable: false },
        { pubkey: escrowPda, isSigner: false, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: recipientTokenAccount, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data,
    });
}

export function buildRefundInstruction({
  paymentHashHex,
  refund,
  refundTokenAccount,
  programId = LN_USDT_ESCROW_PROGRAM_ID,
}) {
  const { pda: escrowPda } = deriveEscrowPda(paymentHashHex, programId);
  const data = Buffer.from([2]);
  return (vault) =>
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: refund, isSigner: true, isWritable: false },
        { pubkey: escrowPda, isSigner: false, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: refundTokenAccount, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      ],
      data,
    });
}

export function decodeEscrowState(data) {
  const buf = Buffer.from(data);
  if (buf.length < 179) throw new Error('Escrow account too small');
  const v = buf.readUInt8(0);
  const status = buf.readUInt8(1);
  const paymentHash = buf.subarray(2, 34);
  const recipient = new PublicKey(buf.subarray(34, 66));
  const refund = new PublicKey(buf.subarray(66, 98));
  const refundAfter = buf.readBigInt64LE(98);
  const mint = new PublicKey(buf.subarray(106, 138));
  const amount = buf.readBigUInt64LE(138);
  const vault = new PublicKey(buf.subarray(146, 178));
  const bump = buf.readUInt8(178);
  return {
    v,
    status,
    paymentHashHex: paymentHash.toString('hex'),
    recipient,
    refund,
    refundAfter,
    mint,
    amount,
    vault,
    bump,
  };
}

export async function getEscrowState(connection, paymentHashHex, programId = LN_USDT_ESCROW_PROGRAM_ID) {
  const { pda } = deriveEscrowPda(paymentHashHex, programId);
  const info = await connection.getAccountInfo(pda, 'confirmed');
  if (!info) return null;
  return decodeEscrowState(info.data);
}

export async function createEscrowTx({
  connection,
  payer,
  payerTokenAccount,
  mint,
  paymentHashHex,
  recipient,
  refund,
  refundAfterUnix,
  amount,
  programId = LN_USDT_ESCROW_PROGRAM_ID,
}) {
  const { pda: escrowPda } = deriveEscrowPda(paymentHashHex, programId);
  const vault = await deriveVaultAta(escrowPda, mint);

  const initIxFactory = buildInitInstruction({
    paymentHashHex,
    recipient,
    refund,
    refundAfterUnix,
    amount,
    payer: payer.publicKey,
    payerTokenAccount,
    mint,
    programId,
  });

  const tx = new Transaction();
  // Note: The program CPI creates the escrow PDA and vault ATA; the transaction contains only the init instruction.
  const initIx = initIxFactory(vault);
  tx.add(initIx);

  tx.feePayer = payer.publicKey;
  const latest = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = latest.blockhash;
  tx.sign(payer);
  return { tx, escrowPda, vault };
}

export async function claimEscrowTx({
  connection,
  recipient,
  recipientTokenAccount,
  mint,
  paymentHashHex,
  preimageHex,
  programId = LN_USDT_ESCROW_PROGRAM_ID,
}) {
  const { pda: escrowPda } = deriveEscrowPda(paymentHashHex, programId);
  const vault = await deriveVaultAta(escrowPda, mint);
  const claimIxFactory = buildClaimInstruction({
    preimageHex,
    paymentHashHex,
    recipient: recipient.publicKey,
    recipientTokenAccount,
    mint,
    programId,
  });
  const tx = new Transaction().add(claimIxFactory(vault));
  tx.feePayer = recipient.publicKey;
  const latest = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = latest.blockhash;
  tx.sign(recipient);
  return { tx, escrowPda, vault };
}
