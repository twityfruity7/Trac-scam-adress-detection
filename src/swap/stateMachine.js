import { KIND, STATE } from './constants.js';
import { hashUnsignedEnvelope } from './hash.js';
import { validateSwapEnvelope } from './schema.js';
import { verifySignedEnvelope } from '../protocol/signedMessage.js';

const clone = (v) => JSON.parse(JSON.stringify(v));

export function createInitialTrade(tradeId) {
  if (!tradeId || typeof tradeId !== 'string') throw new Error('tradeId is required');
  return {
    trade_id: tradeId,
    state: STATE.INIT,
    terms: null,
    terms_hash: null,
    invoice: null,
    escrow: null,
    last: null,
    accepted_at: null,
    canceled_reason: null,
  };
}

function requireSigner(envelope, expectedSignerHex, label) {
  const signer = String(envelope?.signer || '').trim().toLowerCase();
  const exp = String(expectedSignerHex || '').trim().toLowerCase();
  if (!signer || !exp || signer !== exp) {
    return { ok: false, error: `${label}: wrong signer` };
  }
  return { ok: true, error: null };
}

export function applySwapEnvelope(trade, envelope) {
  if (!trade || typeof trade !== 'object') return { ok: false, error: 'Trade state missing', trade: null };

  // Validate schema first (fast fail) before signature checks.
  const v = validateSwapEnvelope(envelope);
  if (!v.ok) return { ok: false, error: v.error, trade: null };

  if (envelope.trade_id !== trade.trade_id) {
    return { ok: false, error: 'trade_id mismatch', trade: null };
  }

  const sig = verifySignedEnvelope(envelope);
  if (!sig.ok) return { ok: false, error: `bad signature: ${sig.error}`, trade: null };

  const next = clone(trade);
  next.last = { kind: envelope.kind, ts: envelope.ts, signer: envelope.signer };

  switch (envelope.kind) {
    case KIND.TERMS: {
      if (![STATE.INIT, STATE.TERMS].includes(next.state)) {
        return { ok: false, error: `TERMS not allowed in state=${next.state}`, trade: null };
      }
      // Terms must be authored by the LN receiver (the USDT depositor side in this swap orientation).
      const rs = requireSigner(envelope, envelope.body.ln_receiver_peer, 'terms');
      if (!rs.ok) return { ok: false, error: rs.error, trade: null };

      next.terms = envelope.body;
      next.terms_hash = hashUnsignedEnvelope((({ sig: _sig, signer: _signer, ...u }) => u)(envelope));
      next.state = STATE.TERMS;
      next.accepted_at = null;
      return { ok: true, error: null, trade: next };
    }

    case KIND.ACCEPT: {
      if (next.state !== STATE.TERMS || !next.terms || !next.terms_hash) {
        return { ok: false, error: 'ACCEPT requires active terms', trade: null };
      }
      const rs = requireSigner(envelope, next.terms.ln_payer_peer, 'accept');
      if (!rs.ok) return { ok: false, error: rs.error, trade: null };
      if (String(envelope.body.terms_hash).trim().toLowerCase() !== String(next.terms_hash).toLowerCase()) {
        return { ok: false, error: 'ACCEPT terms_hash mismatch', trade: null };
      }
      next.state = STATE.ACCEPTED;
      next.accepted_at = envelope.ts;
      return { ok: true, error: null, trade: next };
    }

    case KIND.LN_INVOICE: {
      if (![STATE.ACCEPTED, STATE.INVOICE, STATE.ESCROW].includes(next.state)) {
        return { ok: false, error: `LN_INVOICE not allowed in state=${next.state}`, trade: null };
      }
      if (!next.terms) return { ok: false, error: 'LN_INVOICE requires terms', trade: null };
      const rs = requireSigner(envelope, next.terms.ln_receiver_peer, 'ln_invoice');
      if (!rs.ok) return { ok: false, error: rs.error, trade: null };
      next.invoice = envelope.body;
      // Only move forward if we weren't already past invoice.
      if (next.state === STATE.ACCEPTED) next.state = STATE.INVOICE;
      return { ok: true, error: null, trade: next };
    }

    case KIND.SOL_ESCROW_CREATED: {
      if (![STATE.INVOICE, STATE.ESCROW].includes(next.state)) {
        return { ok: false, error: `SOL_ESCROW_CREATED not allowed in state=${next.state}`, trade: null };
      }
      if (!next.terms) return { ok: false, error: 'SOL_ESCROW_CREATED requires terms', trade: null };
      if (!next.invoice) return { ok: false, error: 'SOL_ESCROW_CREATED requires invoice', trade: null };
      const rs = requireSigner(envelope, next.terms.ln_receiver_peer, 'sol_escrow_created');
      if (!rs.ok) return { ok: false, error: rs.error, trade: null };
      // Basic cross-checks with terms.
      if (envelope.body.recipient !== next.terms.sol_recipient) {
        return { ok: false, error: 'SOL escrow recipient mismatch vs terms', trade: null };
      }
      if (envelope.body.refund !== next.terms.sol_refund) {
        return { ok: false, error: 'SOL escrow refund mismatch vs terms', trade: null };
      }
      if (envelope.body.mint !== next.terms.sol_mint) {
        return { ok: false, error: 'SOL escrow mint mismatch vs terms', trade: null };
      }
      if (String(envelope.body.amount) !== String(next.terms.usdt_amount)) {
        return { ok: false, error: 'SOL escrow amount mismatch vs terms', trade: null };
      }
      next.escrow = envelope.body;
      next.state = STATE.ESCROW;
      return { ok: true, error: null, trade: next };
    }

    case KIND.LN_PAID: {
      if (![STATE.ESCROW, STATE.LN_PAID].includes(next.state)) {
        return { ok: false, error: `LN_PAID not allowed in state=${next.state}`, trade: null };
      }
      if (!next.terms) return { ok: false, error: 'LN_PAID requires terms', trade: null };
      const rs = requireSigner(envelope, next.terms.ln_payer_peer, 'ln_paid');
      if (!rs.ok) return { ok: false, error: rs.error, trade: null };
      next.state = STATE.LN_PAID;
      return { ok: true, error: null, trade: next };
    }

    case KIND.SOL_CLAIMED: {
      if (![STATE.ESCROW, STATE.LN_PAID, STATE.CLAIMED].includes(next.state)) {
        return { ok: false, error: `SOL_CLAIMED not allowed in state=${next.state}`, trade: null };
      }
      if (!next.terms) return { ok: false, error: 'SOL_CLAIMED requires terms', trade: null };
      const rs = requireSigner(envelope, next.terms.ln_payer_peer, 'sol_claimed');
      if (!rs.ok) return { ok: false, error: rs.error, trade: null };
      next.state = STATE.CLAIMED;
      return { ok: true, error: null, trade: next };
    }

    case KIND.SOL_REFUNDED: {
      if (![STATE.ESCROW, STATE.REFUNDED].includes(next.state)) {
        return { ok: false, error: `SOL_REFUNDED not allowed in state=${next.state}`, trade: null };
      }
      if (!next.terms) return { ok: false, error: 'SOL_REFUNDED requires terms', trade: null };
      const rs = requireSigner(envelope, next.terms.ln_receiver_peer, 'sol_refunded');
      if (!rs.ok) return { ok: false, error: rs.error, trade: null };
      next.state = STATE.REFUNDED;
      return { ok: true, error: null, trade: next };
    }

    case KIND.CANCEL: {
      if ([STATE.CLAIMED, STATE.REFUNDED].includes(next.state)) {
        return { ok: false, error: `CANCEL not allowed in terminal state=${next.state}`, trade: null };
      }
      // Either side may cancel before escrow is created.
      if ([STATE.ESCROW, STATE.LN_PAID].includes(next.state)) {
        return { ok: false, error: `CANCEL not allowed after escrow creation (state=${next.state})`, trade: null };
      }
      next.state = STATE.CANCELED;
      next.canceled_reason = envelope.body.reason || null;
      return { ok: true, error: null, trade: next };
    }

    case KIND.STATUS: {
      // Status is informational; do not mutate state except maybe keep last.
      return { ok: true, error: null, trade: next };
    }

    default:
      return { ok: false, error: `Unhandled kind: ${envelope.kind}`, trade: null };
  }
}

