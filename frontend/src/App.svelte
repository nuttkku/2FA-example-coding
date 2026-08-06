<script>
  import { onMount } from 'svelte';
  import Router, { push } from 'svelte-spa-router';
  import { wrap } from 'svelte-spa-router/wrap';
  import { authStore } from './lib/stores/auth.js';
  import { authGuard, adminGuard, userManagementReadGuard } from './lib/guards.js';
  import Navbar from './components/Navbar.svelte';

  import Login from './pages/Login.svelte';
  import Setup2FA from './pages/Setup2FA.svelte';
  import Verify2FA from './pages/Verify2FA.svelte';
  import BackupCodes from './pages/BackupCodes.svelte';
  import ChangePassword from './pages/ChangePassword.svelte';
  import Dashboard from './pages/Dashboard.svelte';
  import Profile from './pages/Profile.svelte';
  import AdminUsers from './pages/AdminUsers.svelte';
  import AdminAuditLog from './pages/AdminAuditLog.svelte';
  import Unauthorized from './pages/Unauthorized.svelte';
  import NotFound from './pages/NotFound.svelte';

  const routes = {
    '/login': Login,
    '/2fa/setup': Setup2FA,
    '/2fa/verify': Verify2FA,
    '/2fa/backup-codes': BackupCodes,
    '/change-password': wrap({ component: ChangePassword, conditions: [authGuard] }),
    '/dashboard': wrap({ component: Dashboard, conditions: [authGuard] }),
    '/profile': wrap({ component: Profile, conditions: [authGuard] }),
    '/admin/users': wrap({ component: AdminUsers, conditions: [authGuard, userManagementReadGuard] }),
    '/admin/audit-logs': wrap({ component: AdminAuditLog, conditions: [authGuard, adminGuard] }),
    '/unauthorized': Unauthorized,
    '*': NotFound,
  };

  let ready = false;

  onMount(async () => {
    await authStore.refresh();
    ready = true;
  });

  function handleConditionsFailed() {
    push($authStore.status === 'authenticated' ? '/unauthorized' : '/login');
  }
</script>

<Navbar />

{#if ready}
  <Router {routes} on:conditionsFailed={handleConditionsFailed} />
{:else}
  <div class="center">Loading…</div>
{/if}
