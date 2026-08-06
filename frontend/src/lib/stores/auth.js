import { writable } from 'svelte/store';
import { api } from '../api.js';

function createAuthStore() {
  const store = writable({ status: 'loading', user: null });

  async function refresh() {
    try {
      const { user } = await api.me();
      store.set({ status: 'authenticated', user });
      return user;
    } catch {
      store.set({ status: 'unauthenticated', user: null });
      return null;
    }
  }

  function clear() {
    store.set({ status: 'unauthenticated', user: null });
  }

  return { subscribe: store.subscribe, refresh, clear };
}

export const authStore = createAuthStore();
