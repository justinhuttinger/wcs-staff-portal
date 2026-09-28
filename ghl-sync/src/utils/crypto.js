// Decrypt values the portal encrypted with VAULT_ENCRYPTION_KEY
// (AES-256-GCM, base64 of IV + auth tag + ciphertext). Same format as
// auth/src/utils/crypto.js; ghl-sync only ever decrypts.
const crypto = require('crypto');

const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function decrypt(encoded) {
  const hex = process.env.VAULT_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) throw new Error('VAULT_ENCRYPTION_KEY is not set');
  const combined = Buffer.from(encoded, 'base64');
  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(hex, 'hex'), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

module.exports = { decrypt };
