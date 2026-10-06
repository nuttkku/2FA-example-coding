import { env } from '../config/env.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { hashSecret, verifySecret, DUMMY_PASSWORD_HASH } from '../utils/password.js';
import { UnauthorizedError, ForbiddenError, ValidationError, ConflictError } from '../utils/errors.js';
import {
  loginSchema,
  twoFaCodeSchema,
  changePasswordSchema,
} from '../validators/schemas.js';
import {
  findByEmail,
  findById,
  recordFailedLogin,
  resetFailedLogins,
  setPasswordHash,
  enableTotp,
  recordFailedTwoFactor,
  resetFailedTwoFactor,
} from '../services/user.service.js';
import { recordEvent } from '../services/audit.service.js';
import {
  issuePreAuthCookie,
  issueFullSession,
  issueAccessCookie,
  rotateRefreshCookie,
  revokeRefreshCookie,
  revokeAllForUser,
  clearSessionCookies,
} from '../services/token.service.js';
import {
  generateTotpSecret,
  buildQrCode,
  storePendingSecret,
  decryptStoredSecret,
  verifyTotpCode,
  issueBackupCodes,
  consumeBackupCode,
  looksLikeBackupCode,
} from '../services/twofa.service.js';

export const login = asyncHandler(async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const user = await findByEmail(email);
  const invalidCredentials = () => new UnauthorizedError('Invalid email or password');

  // Always run a bcrypt comparison of the same cost, whether or not the account
  // exists (and even if it exists but has no local password - an SSO-only
  // account). Skipping bcrypt on the "not found" path would make that path
  // measurably faster than a real wrong-password check, letting an attacker
  // enumerate registered emails purely by timing the response.
  const passwordValid = await verifySecret(password, user?.password_hash ?? DUMMY_PASSWORD_HASH);

  if (!user) {
    await recordEvent({ eventType: 'login_failed', ipAddress: req.ip, metadata: { email } });
    throw invalidCredentials();
  }

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new ForbiddenError('Account temporarily locked due to repeated failed attempts. Please try again later.');
  }

  if (user.status === 'disabled') {
    throw new ForbiddenError('This account has been disabled. Contact an administrator.');
  }

  if (!passwordValid) {
    await recordFailedLogin(user.id, {
      maxAttempts: env.LOGIN_MAX_ATTEMPTS,
      lockMinutes: env.LOGIN_LOCK_MINUTES,
    });
    await recordEvent({ userId: user.id, eventType: 'login_failed', ipAddress: req.ip });
    throw invalidCredentials();
  }

  await resetFailedLogins(user.id);
  await recordEvent({ userId: user.id, eventType: 'login_password_verified', ipAddress: req.ip });

  // Every account, with no exceptions, continues into a 2FA stage here - there
  // is no branch that grants a session from a password check alone.
  if (!user.totp_enabled) {
    issuePreAuthCookie(res, user.id, 'setup');
    return res.json({ stage: 'setup_required' });
  }

  issuePreAuthCookie(res, user.id, 'verify');
  return res.json({ stage: 'verify_required' });
});

// The pre-auth cookie only proves the password (or SSO) step passed when it was
// issued, up to PRE_AUTH_TOKEN_TTL ago - re-check the account is still usable
// (not deleted/disabled by an admin in the meantime, not 2FA-locked) before
// letting it finish the 2FA step and receive a full session.
async function loadPreAuthUser(req) {
  const user = await findById(req.preAuthUserId);
  if (!user) throw new UnauthorizedError('2FA session expired, please log in again');
  if (user.status === 'disabled') {
    throw new ForbiddenError('This account has been disabled. Contact an administrator.');
  }
  if (user.twofa_locked_until && new Date(user.twofa_locked_until) > new Date()) {
    throw new ForbiddenError('Too many incorrect verification codes. Please try again later.');
  }
  return user;
}

async function recordTwoFactorFailure(req, user, eventType) {
  await recordFailedTwoFactor(user.id, {
    maxAttempts: env.TWOFA_MAX_ATTEMPTS,
    lockMinutes: env.TWOFA_LOCK_MINUTES,
  });
  await recordEvent({ userId: user.id, eventType, ipAddress: req.ip });
}

export const startTwoFactorSetup = asyncHandler(async (req, res) => {
  const user = await loadPreAuthUser(req);
  if (user.totp_enabled) throw new ConflictError('2FA is already enabled for this account');

  const secret = generateTotpSecret();
  await storePendingSecret(user.id, secret);
  const { qrCodeDataUrl } = await buildQrCode(secret, user.email);

  res.json({ qrCodeDataUrl, secret });
});

export const confirmTwoFactorSetup = asyncHandler(async (req, res) => {
  const { code } = twoFaCodeSchema.parse(req.body);
  const user = await loadPreAuthUser(req);

  if (user.totp_enabled) throw new ConflictError('2FA is already enabled for this account');
  if (!user.totp_secret_enc) throw new ValidationError('No pending 2FA setup found, please restart setup');

  const secret = decryptStoredSecret(user.totp_secret_enc);
  const valid = await verifyTotpCode(user.id, secret, code);
  if (!valid) {
    await recordTwoFactorFailure(req, user, '2fa_setup_failed');
    throw new ValidationError('Invalid verification code');
  }

  await enableTotp(user.id);
  await resetFailedTwoFactor(user.id);
  const backupCodes = await issueBackupCodes(user.id);
  await recordEvent({ userId: user.id, eventType: '2fa_setup_complete', ipAddress: req.ip });

  await issueFullSession(req, res, user);

  res.json({ stage: 'complete', backupCodes, mustChangePassword: user.must_change_password });
});

export const verifyTwoFactor = asyncHandler(async (req, res) => {
  const { code } = twoFaCodeSchema.parse(req.body);
  const user = await loadPreAuthUser(req);

  if (!user.totp_enabled || !user.totp_secret_enc) {
    throw new ValidationError('2FA is not set up for this account');
  }

  let valid;
  let usedBackupCode = false;
  if (looksLikeBackupCode(code)) {
    valid = await consumeBackupCode(user.id, code);
    usedBackupCode = valid;
  } else {
    const secret = decryptStoredSecret(user.totp_secret_enc);
    valid = await verifyTotpCode(user.id, secret, code);
  }

  if (!valid) {
    await recordTwoFactorFailure(req, user, '2fa_verify_failed');
    throw new ValidationError('Invalid verification code');
  }

  await resetFailedTwoFactor(user.id);
  await recordEvent({
    userId: user.id,
    eventType: usedBackupCode ? '2fa_backup_code_used' : '2fa_verify_success',
    ipAddress: req.ip,
  });
  await issueFullSession(req, res, user);

  res.json({ stage: 'complete', mustChangePassword: user.must_change_password });
});

export const refresh = asyncHandler(async (req, res) => {
  const userId = await rotateRefreshCookie(req, res);
  const user = await findById(userId);
  // requireAuth already rejects disabled accounts per request, but don't keep
  // minting fresh tokens for an account that is gone or disabled either.
  if (!user || user.status === 'disabled') {
    if (user) await revokeAllForUser(user.id);
    clearSessionCookies(res);
    throw new UnauthorizedError('Session expired, please log in again');
  }
  issueAccessCookie(res, user);
  res.json({ ok: true });
});

export const logout = asyncHandler(async (req, res) => {
  await revokeRefreshCookie(req);
  clearSessionCookies(res);
  res.json({ ok: true });
});

export const me = asyncHandler(async (req, res) => {
  const user = req.user;
  res.json({
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      totpEnabled: user.totp_enabled,
      mustChangePassword: user.must_change_password,
      hasPassword: user.password_hash !== null,
    },
  });
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

  if (!req.user.password_hash) {
    throw new ValidationError('This account signs in via SSO and has no password to change');
  }

  const valid = await verifySecret(currentPassword, req.user.password_hash);
  if (!valid) throw new UnauthorizedError('Current password is incorrect');

  const passwordHash = await hashSecret(newPassword);
  await setPasswordHash(req.user.id, passwordHash, { mustChangePassword: false });
  // A password change is usually a response to suspected compromise - end every
  // other session (each device's refresh token) and re-issue one for this device.
  await revokeAllForUser(req.user.id);
  await issueFullSession(req, res, req.user);
  await recordEvent({ userId: req.user.id, eventType: 'password_changed', ipAddress: req.ip });

  res.json({ ok: true });
});

// Step-up: a session alone is not enough to mint a fresh set of backup codes -
// they are long-lived 2FA bypass credentials, so a stolen session cookie must
// not be able to turn itself into permanent 2FA access. Require a current TOTP
// code (not a backup code: the point is to prove possession of the device).
// Failures count toward the same per-account 2FA lockout as login.
export const regenerateBackupCodes = asyncHandler(async (req, res) => {
  const { code } = twoFaCodeSchema.parse(req.body);
  const user = req.user;

  if (!user.totp_enabled || !user.totp_secret_enc) {
    throw new ValidationError('2FA is not set up for this account');
  }
  if (user.twofa_locked_until && new Date(user.twofa_locked_until) > new Date()) {
    throw new ForbiddenError('Too many incorrect verification codes. Please try again later.');
  }

  const valid = !looksLikeBackupCode(code)
    && await verifyTotpCode(user.id, decryptStoredSecret(user.totp_secret_enc), code);
  if (!valid) {
    await recordTwoFactorFailure(req, user, 'backup_codes_regenerate_failed');
    throw new ValidationError('Invalid verification code');
  }
  await resetFailedTwoFactor(user.id);

  const backupCodes = await issueBackupCodes(req.user.id);
  await recordEvent({ userId: req.user.id, eventType: 'backup_codes_regenerated', ipAddress: req.ip });
  res.json({ backupCodes });
});
