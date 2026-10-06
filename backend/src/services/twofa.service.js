import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { encryptSecret, decryptSecret } from '../utils/crypto.js';
import { generateBackupCodes, normalizeBackupCode } from '../utils/backupCodes.js';
import { verifySecret } from '../utils/password.js';
import { setTotpSecretPending, claimTotpStep } from './user.service.js';

authenticator.options = { window: 1 };

export function generateTotpSecret() {
  return authenticator.generateSecret();
}

export async function buildQrCode(secretBase32, email) {
  const otpauthUrl = authenticator.keyuri(email, env.TWOFA_ISSUER, secretBase32);
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);
  return { otpauthUrl, qrCodeDataUrl };
}

// Checks the code and, if valid, claims its time-step for this user so the same
// code can never be accepted twice (RFC 6238 section 5.2). otplib's plain
// check() is stateless and would accept a code again for as long as it stays
// inside the +/-1 step window (up to ~90s).
export async function verifyTotpCode(userId, secretBase32, code) {
  const now = Date.now();
  const checker = authenticator.clone({ epoch: now });
  const delta = checker.checkDelta(code, secretBase32);
  if (delta === null) return false;

  const step = Math.floor(now / 1000 / checker.allOptions().step) + delta;
  return claimTotpStep(userId, step);
}

export async function storePendingSecret(userId, secretBase32) {
  await setTotpSecretPending(userId, encryptSecret(secretBase32));
}

export function decryptStoredSecret(encryptedSecret) {
  return decryptSecret(encryptedSecret);
}

export async function issueBackupCodes(userId) {
  const { plainCodes, hashedCodes } = await generateBackupCodes();

  await pool.query('DELETE FROM backup_codes WHERE user_id = $1', [userId]);
  const values = hashedCodes.map((_, i) => `($1, $${i + 2})`).join(', ');
  await pool.query(`INSERT INTO backup_codes (user_id, code_hash) VALUES ${values}`, [userId, ...hashedCodes]);

  return plainCodes;
}

export async function consumeBackupCode(userId, code) {
  const normalized = normalizeBackupCode(code);
  const { rows } = await pool.query(
    'SELECT id, code_hash FROM backup_codes WHERE user_id = $1 AND used_at IS NULL',
    [userId],
  );

  for (const row of rows) {
    if (await verifySecret(normalized, row.code_hash)) {
      // Conditional update so two concurrent requests with the same code can't
      // both succeed - only the one that actually flips used_at wins.
      const { rowCount } = await pool.query(
        'UPDATE backup_codes SET used_at = now() WHERE id = $1 AND used_at IS NULL',
        [row.id],
      );
      return rowCount === 1;
    }
  }
  return false;
}

export function looksLikeBackupCode(code) {
  return /^[A-Z0-9]{4}-?[A-Z0-9]{4}$/i.test(normalizeBackupCode(code));
}
