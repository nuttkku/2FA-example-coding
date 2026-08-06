import { verifyAccessCookie, verifyPreAuthCookie } from '../services/token.service.js';
import { findById } from '../services/user.service.js';
import { UnauthorizedError, ForbiddenError } from '../utils/errors.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const requireAuth = asyncHandler(async (req, res, next) => {
  const payload = verifyAccessCookie(req);
  const user = await findById(payload.sub);

  if (!user) throw new UnauthorizedError('Not authenticated');
  if (user.status === 'disabled') throw new ForbiddenError('Account disabled');

  req.user = user;
  next();
});

export function requirePreAuth(stage) {
  return (req, res, next) => {
    const payload = verifyPreAuthCookie(req, stage);
    req.preAuthUserId = payload.sub;
    next();
  };
}
