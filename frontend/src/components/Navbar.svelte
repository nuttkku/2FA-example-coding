<script>
  import { push } from 'svelte-spa-router';
  import { authStore } from '../lib/stores/auth.js';
  import { api } from '../lib/api.js';

  async function handleLogout() {
    try {
      await api.logout();
    } finally {
      authStore.clear();
      push('/login');
    }
  }
</script>

<nav
  style="display:flex; align-items:center; justify-content:space-between; padding:0.9rem 1.5rem; border-bottom:1px solid var(--color-border); background:var(--color-surface);"
>
  <a href="#/dashboard" style="font-weight:700; color:var(--color-text);">🔐 2FA Example</a>

  <div class="row">
    {#if $authStore.status === 'authenticated'}
      <a href="#/dashboard">Dashboard</a>
      <a href="#/profile">Profile</a>
      {#if ['admin', 'manager'].includes($authStore.user?.role)}
        <a href="#/admin/users">Users</a>
      {/if}
      {#if $authStore.user?.role === 'admin'}
        <a href="#/admin/audit-logs">Audit log</a>
      {/if}
      <span class="badge badge-{$authStore.user?.role}">{$authStore.user?.role}</span>
      <button class="btn btn-secondary btn-sm" on:click={handleLogout}>Log out</button>
    {:else if $authStore.status === 'unauthenticated'}
      <a href="#/login">Sign in</a>
    {/if}
  </div>
</nav>
