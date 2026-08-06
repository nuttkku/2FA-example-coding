export const ROLES = ['admin', 'manager', 'user'];

// Central RBAC map: permission -> roles allowed to perform it.
// Adding a new permission or role only ever touches this file and the route
// that guards itself with requirePermission().
export const PERMISSIONS = {
  'users:read': ['admin', 'manager'],
  'users:write': ['admin'],
  'audit:read': ['admin'],
};

export function roleHasPermission(role, permission) {
  const allowedRoles = PERMISSIONS[permission];
  if (!allowedRoles) return false;
  return allowedRoles.includes(role);
}
