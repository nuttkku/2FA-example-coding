import { roleHasPermission } from '../config/permissions.js';
import { ForbiddenError } from '../utils/errors.js';

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user || !roleHasPermission(req.user.role, permission)) {
      throw new ForbiddenError('You do not have permission to perform this action');
    }
    next();
  };
}
