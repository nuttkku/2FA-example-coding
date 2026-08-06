import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { pool } from '../config/db.js';
import { UnauthorizedError } from '../utils/errors.js';

export const COOKIE_NAMES = {
  preAuth: 'pre_auth_token',
  access: 'access_token',
  refresh: 'refresh_token',
};

const COOKIE_BASE = {
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: 'lax',
  path: '/',
};

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function signWithMaxAge(payload, secret, ttl) {
  const token = jwt.sign(payload, secret, { expiresIn: ttl });
  const { exp } = jwt.decode(token);
  const maxAge = exp * 1000 - Date.now();
  return { token, maxAge };
}

// --- Pre-auth token: issued right after password verification, before 2FA is
// satisfied. It only ever carries enough authority to complete the specific
// 2FA stage it was issued for - it cannot be used to call any authenticated API.
export function issuePreAuthCookie(res, userId, stage) {
  const { token, maxAge } = signWithMaxAge(
    { sub: userId, stage, typ: 'pre_auth' },
    env.PRE_AUTH_TOKEN_SECRET,
    env.PRE_AUTH_TOKEN_TTL,
  );
  res.cookie(COOKIE_NAMES.preAuth, token, { ...COOKIE_BASE, maxAge });
}

export function verifyPreAuthCookie(req, expectedStage) {
  const token = req.cookies[COOKIE_NAMES.preAuth];
  if (!token) throw new UnauthorizedError('2FA session expired, please log in again');

  let payload;
  try {
    payload = jwt.verify(token, env.PRE_AUTH_TOKEN_SECRET);
  } catch {
    throw new UnauthorizedError('2FA session expired, please log in again');
  }

  if (payload.typ !== 'pre_auth' || payload.stage !== expectedStage) {
    throw new UnauthorizedError('2FA session expired, please log in again');
  }
  return payload;
}

export function clearPreAuthCookie(res) {
  res.clearCookie(COOKIE_NAMES.preAuth, COOKIE_BASE);
}

// --- Access token: short-lived, used to authenticate normal API calls.
export function issueAccessCookie(res, user) {
  const { token, maxAge } = signWithMaxAge(
    { sub: user.id, role: user.role, typ: 'access' },
    env.ACCESS_TOKEN_SECRET,
    env.ACCESS_TOKEN_TTL,
  );
  res.cookie(COOKIE_NAMES.access, token, { ...COOKIE_BASE, maxAge });
}

export function verifyAccessCookie(req) {
  const token = req.cookies[COOKIE_NAMES.access];
  if (!token) throw new UnauthorizedError('Not authenticated');

  let payload;
  try {
    payload = jwt.verify(token, env.ACCESS_TOKEN_SECRET);
  } catch {
    throw new UnauthorizedError('Session expired');
  }

  if (payload.typ !== 'access') throw new UnauthorizedError('Not authenticated');
  return payload;
}

// --- Refresh token: long-lived, stored server-side only as a hash so a leaked
// database dump does not hand out usable sessions. Rotated on every use; if a
// token that was already rotated away is ever presented again, that is a strong
// signal of theft, so we revoke the entire session family for that user.
export async function issueRefreshCookie(res, userId, { ipAddress, userAgent } = {}) {
  const jti = crypto.randomUUID();
  const { token, maxAge } = signWithMaxAge(
    { sub: userId, jti, typ: 'refresh' },
    env.REFRESH_TOKEN_SECRET,
    env.REFRESH_TOKEN_TTL,
  );

  await pool.query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, now() + ($4 || ' milliseconds')::interval, $5, $6)`,
    [jti, userId, sha256(token), maxAge, ipAddress ?? null, userAgent ?? null],
  );

  res.cookie(COOKIE_NAMES.refresh, token, { ...COOKIE_BASE, maxAge });
}

export async function rotateRefreshCookie(req, res) {
  const token = req.cookies[COOKIE_NAMES.refresh];
  if (!token) throw new UnauthorizedError('Not authenticated');

  let payload;
  try {
    payload = jwt.verify(token, env.REFRESH_TOKEN_SECRET);
  } catch {
    throw new UnauthorizedError('Session expired, please log in again');
  }
  if (payload.typ !== 'refresh') throw new UnauthorizedError('Not authenticated');

  const { rows } = await pool.query('SELECT * FROM refresh_tokens WHERE id = $1', [payload.jti]);
  const record = rows[0];

  if (!record || record.token_hash !== sha256(token)) {
    throw new UnauthorizedError('Session expired, please log in again');
  }

  if (record.revoked_at) {
    await revokeAllForUser(payload.sub);
    throw new UnauthorizedError('Session revoked - please log in again');
  }

  await pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [payload.jti]);
  await issueRefreshCookie(res, payload.sub, {
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });

  return payload.sub;
}

export async function revokeRefreshCookie(req) {
  const token = req.cookies[COOKIE_NAMES.refresh];
  if (!token) return;
  try {
    const payload = jwt.verify(token, env.REFRESH_TOKEN_SECRET);
    await pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [
      payload.jti,
    ]);
  } catch {
    // Token already invalid/expired - nothing to revoke.
  }
}

export async function revokeAllForUser(userId) {
  await pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [
    userId,
  ]);
}

export function clearSessionCookies(res) {
  res.clearCookie(COOKIE_NAMES.access, COOKIE_BASE);
  res.clearCookie(COOKIE_NAMES.refresh, COOKIE_BASE);
}

export async function issueFullSession(req, res, user) {
  issueAccessCookie(res, user);
  await issueRefreshCookie(res, user.id, { ipAddress: req.ip, userAgent: req.get('user-agent') });
  clearPreAuthCookie(res);
}
