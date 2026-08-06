import crypto from 'node:crypto';
import { hashSecret } from './password.js';

// Excludes visually ambiguous characters (0/O, 1/I/L).
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_COUNT = 10;
const GROUP_LENGTH = 4;

function randomCode() {
  let code = '';
  for (let i = 0; i < GROUP_LENGTH * 2; i += 1) {
    code += ALPHABET[crypto.randomInt(ALPHABET.length)];
    if (i === GROUP_LENGTH - 1) code += '-';
  }
  return code;
}

export function normalizeBackupCode(code) {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

// Backup codes are single-use recovery credentials, so - like passwords - only
// their hash is stored. The plaintext codes are returned once and never persisted.
export async function generateBackupCodes() {
  const plainCodes = Array.from({ length: CODE_COUNT }, randomCode);
  const hashedCodes = await Promise.all(plainCodes.map((code) => hashSecret(code)));
  return { plainCodes, hashedCodes };
}
