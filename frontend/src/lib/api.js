const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : null;

  if (!res.ok) {
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, data?.details);
  }
  return data;
}

export const api = {
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  setupTwoFactor: () => request('/auth/2fa/setup', { method: 'POST' }),
  confirmTwoFactorSetup: (code) => request('/auth/2fa/setup/confirm', { method: 'POST', body: { code } }),
  verifyTwoFactor: (code) => request('/auth/2fa/verify', { method: 'POST', body: { code } }),
  me: () => request('/auth/me'),
  logout: () => request('/auth/logout', { method: 'POST' }),
  changePassword: (currentPassword, newPassword) =>
    request('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } }),
  regenerateBackupCodes: () => request('/auth/2fa/backup-codes/regenerate', { method: 'POST' }),

  admin: {
    listUsers: (search) =>
      request(`/admin/users${search ? `?search=${encodeURIComponent(search)}` : ''}`),
    createUser: (payload) => request('/admin/users', { method: 'POST', body: payload }),
    updateUser: (id, payload) => request(`/admin/users/${id}`, { method: 'PATCH', body: payload }),
    resetPassword: (id, temporaryPassword) =>
      request(`/admin/users/${id}/reset-password`, { method: 'POST', body: { temporaryPassword } }),
    resetTwoFactor: (id) => request(`/admin/users/${id}/reset-2fa`, { method: 'POST' }),
    auditLogs: () => request('/admin/audit-logs'),
  },
};
