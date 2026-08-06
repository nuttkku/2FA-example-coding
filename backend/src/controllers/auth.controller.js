import { env } from '../config/env.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { hashSecret, verifySecret } from '../utils/password.js';
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
} from '../services/user.service.js';
import { recordEvent } from '../services/audit.service.js';
import {
  issuePreAuthCookie,
  issueFullSession,
  issueAccessCookie,
  rotateRefreshCookie,
  revokeRefreshCookie,
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

  const passwordValid = await verifySecret(password, user.password_hash);
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

export const startTwoFactorSetup = asyncHandler(async (req, res) => {
  const user = await findById(req.preAuthUserId);
  if (user.totp_enabled) throw new ConflictError('2FA is already enabled for this account');

  const secret = generateTotpSecret();
  await storePendingSecret(user.id, secret);
  const { qrCodeDataUrl } = await buildQrCode(secret, user.email);

  res.json({ qrCodeDataUrl, secret });
});

export const confirmTwoFactorSetup = asyncHandler(async (req, res) => {
  const { code } = twoFaCodeSchema.parse(req.body);
  const user = await findById(req.preAuthUserId);

  if (!user.totp_secret_enc) throw new ValidationError('No pending 2FA setup found, please restart setup');

  const secret = decryptStoredSecret(user.totp_secret_enc);
  const valid = verifyTotpCode(secret, code);
  if (!valid) {
    await recordEvent({ userId: user.id, eventType: '2fa_setup_failed', ipAddress: req.ip });
    throw new ValidationError('Invalid verification code');
  }

  await enableTotp(user.id);
  const backupCodes = await issueBackupCodes(user.id);
  await recordEvent({ userId: user.id, eventType: '2fa_setup_complete', ipAddress: req.ip });

  await issueFullSession(req, res, user);

  res.json({ stage: 'complete', backupCodes, mustChangePassword: user.must_change_password });
});

export const verifyTwoFactor = asyncHandler(async (req, res) => {
  const { code } = twoFaCodeSchema.parse(req.body);
  const user = await findById(req.preAuthUserId);

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
    valid = verifyTotpCode(secret, code);
  }

  if (!valid) {
    await recordEvent({ userId: user.id, eventType: '2fa_verify_failed', ipAddress: req.ip });
    throw new ValidationError('Invalid verification code');
  }

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
    },
  });
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

  const valid = await verifySecret(currentPassword, req.user.password_hash);
  if (!valid) throw new UnauthorizedError('Current password is incorrect');

  const passwordHash = await hashSecret(newPassword);
  await setPasswordHash(req.user.id, passwordHash, { mustChangePassword: false });
  await recordEvent({ userId: req.user.id, eventType: 'password_changed', ipAddress: req.ip });

  res.json({ ok: true });
});

export const regenerateBackupCodes = asyncHandler(async (req, res) => {
  const backupCodes = await issueBackupCodes(req.user.id);
  await recordEvent({ userId: req.user.id, eventType: 'backup_codes_regenerated', ipAddress: req.ip });
  res.json({ backupCodes });
});
