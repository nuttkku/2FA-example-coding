import { asyncHandler } from '../utils/asyncHandler.js';
import { hashSecret } from '../utils/password.js';
import { ConflictError, NotFoundError } from '../utils/errors.js';
import { createUserSchema, updateUserSchema, resetPasswordSchema } from '../validators/schemas.js';
import {
  listUsers,
  createUser,
  findByEmail,
  findById,
  updateRoleAndStatus,
  setPasswordHash,
  resetTwoFactor,
  resetFailedLogins,
} from '../services/user.service.js';
import { revokeAllForUser } from '../services/token.service.js';
import { recordEvent, listEvents } from '../services/audit.service.js';

export const getUsers = asyncHandler(async (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search : null;
  const users = await listUsers({ search });
  res.json({ users });
});

export const postUser = asyncHandler(async (req, res) => {
  const { email, fullName, role, temporaryPassword } = createUserSchema.parse(req.body);

  const existing = await findByEmail(email);
  if (existing) throw new ConflictError('A user with this email already exists');

  const passwordHash = await hashSecret(temporaryPassword);
  const user = await createUser({ email, fullName, passwordHash, role });

  await recordEvent({
    userId: req.user.id,
    eventType: 'admin_user_created',
    ipAddress: req.ip,
    metadata: { targetUserId: user.id, email: user.email, role },
  });

  res.status(201).json({ user });
});

export const patchUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { role, status } = updateUserSchema.parse(req.body);

  const target = await findById(id);
  if (!target) throw new NotFoundError('User not found');

  if (id === req.user.id && ((role && role !== 'admin') || status === 'disabled')) {
    throw new ConflictError('You cannot remove your own admin access or disable your own account');
  }

  const updated = await updateRoleAndStatus(id, { role, status });

  if (status === 'disabled') {
    await revokeAllForUser(id);
  }

  await recordEvent({
    userId: req.user.id,
    eventType: 'admin_user_updated',
    ipAddress: req.ip,
    metadata: { targetUserId: id, role, status },
  });

  res.json({ user: updated });
});

export const postResetPassword = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { temporaryPassword } = resetPasswordSchema.parse(req.body);

  const target = await findById(id);
  if (!target) throw new NotFoundError('User not found');

  const passwordHash = await hashSecret(temporaryPassword);
  await setPasswordHash(id, passwordHash, { mustChangePassword: true });
  await resetFailedLogins(id);
  await revokeAllForUser(id);

  await recordEvent({
    userId: req.user.id,
    eventType: 'admin_password_reset',
    ipAddress: req.ip,
    metadata: { targetUserId: id },
  });

  res.json({ ok: true });
});

export const postResetTwoFactor = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const target = await findById(id);
  if (!target) throw new NotFoundError('User not found');

  // Clearing totp_enabled/totp_secret_enc means the very next login this user
  // attempts drops back into the forced setup stage - there is no way to log
  // in with 2FA left disabled.
  await resetTwoFactor(id);
  await revokeAllForUser(id);

  await recordEvent({
    userId: req.user.id,
    eventType: 'admin_2fa_reset',
    ipAddress: req.ip,
    metadata: { targetUserId: id },
  });

  res.json({ ok: true });
});

export const getAuditLogs = asyncHandler(async (req, res) => {
  const events = await listEvents({ limit: 100 });
  res.json({ events });
});
