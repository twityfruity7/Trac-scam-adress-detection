import { Contract } from 'trac-peer';

// Minimal contract: this app is intentionally "off-contract" for swap settlement.
//
// We keep a contract class because trac-peer expects a contract/protocol pair, but we do not
// implement any transaction-backed state machine here. All swap coordination happens in
// sidechannels (Hyperswarm) and via local-only operator tooling.
class IntercomSwapContract extends Contract {
  constructor(protocol, options = {}) {
    super(protocol, options);
  }
}

export default IntercomSwapContract;

