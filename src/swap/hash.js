import crypto from 'crypto';
import { encodeEnvelopeForSigning } from '../protocol/signedMessage.js';

export function sha256Hex(input) {
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function hashUnsignedEnvelope(unsignedEnvelope) {
  // Hash the exact bytes that were signed (deterministic).
  return sha256Hex(encodeEnvelopeForSigning(unsignedEnvelope));
}

