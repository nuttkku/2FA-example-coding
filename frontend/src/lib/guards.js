import { get } from 'svelte/store';
import { authStore } from './stores/auth.js';

export function authGuard() {
  return get(authStore).status === 'authenticated';
}

export function adminGuard() {
  const { status, user } = get(authStore);
  return status === 'authenticated' && user?.role === 'admin';
}

export function userManagementReadGuard() {
  const { status, user } = get(authStore);
  return status === 'authenticated' && ['admin', 'manager'].includes(user?.role);
}
