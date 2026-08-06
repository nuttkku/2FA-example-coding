import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { encryptSecret, decryptSecret } from '../utils/crypto.js';
import { generateBackupCodes, normalizeBackupCode } from '../utils/backupCodes.js';
import { verifySecret } from '../utils/password.js';
import { setTotpSecretPending } from './user.service.js';

authenticator.options = { window: 1 };

export function generateTotpSecret() {
  return authenticator.generateSecret();
}

export async function buildQrCode(secretBase32, email) {
  const otpauthUrl = authenticator.keyuri(email, env.TWOFA_ISSUER, secretBase32);
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);
  return { otpauthUrl, qrCodeDataUrl };
}

export function verifyTotpCode(secretBase32, code) {
  return authenticator.check(code, secretBase32);
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
      await pool.query('UPDATE backup_codes SET used_at = now() WHERE id = $1', [row.id]);
      return true;
    }
  }
  return false;
}

export function looksLikeBackupCode(code) {
  return /^[A-Z0-9]{4}-?[A-Z0-9]{4}$/i.test(normalizeBackupCode(code));
}
