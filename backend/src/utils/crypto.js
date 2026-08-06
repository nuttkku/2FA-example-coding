import crypto from 'node:crypto';
import { env } from '../config/env.js';

// TOTP secrets must be recoverable in plaintext to verify future codes, so unlike
// passwords they cannot be one-way hashed. AES-256-GCM gives us confidentiality
// (the secret is unreadable if the database leaks) plus integrity (GCM's auth tag
// detects tampering) while still letting the server decrypt it on demand.
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const ENCRYPTION_KEY = Buffer.from(env.TOTP_ENCRYPTION_KEY, 'hex');

export function encryptSecret(plainText) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv, authTag, ciphertext].map((buf) => buf.toString('base64')).join('.');
}

export function decryptSecret(payload) {
  const [ivB64, authTagB64, ciphertextB64] = payload.split('.');
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}
