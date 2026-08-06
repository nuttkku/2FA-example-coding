<script>
  import { push } from 'svelte-spa-router';
  import { authStore } from '../lib/stores/auth.js';
  import { api, ApiError } from '../lib/api.js';
  import { pendingBackupCodes } from '../lib/stores/backupCodes.js';

  let error = '';
  let regenerating = false;

  async function regenerate() {
    error = '';
    regenerating = true;
    try {
      const result = await api.regenerateBackupCodes();
      pendingBackupCodes.set({ codes: result.backupCodes, nextRoute: '/profile' });
      push('/2fa/backup-codes');
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Something went wrong.';
    } finally {
      regenerating = false;
    }
  }
</script>

<div class="page page-narrow">
  <div class="card">
    <h1>Your profile</h1>

    {#if error}
      <div class="alert alert-error">{error}</div>
    {/if}

    <div class="stack">
      <div><strong>Name:</strong> {$authStore.user?.fullName}</div>
      <div><strong>Email:</strong> {$authStore.user?.email}</div>
      <div>
        <strong>Role:</strong>
        <span class="badge badge-{$authStore.user?.role}">{$authStore.user?.role}</span>
      </div>
      <div><strong>2FA status:</strong> <span class="badge badge-active">Enabled</span></div>
    </div>

    <p class="hint" style="margin: 1rem 0;">
      2FA is mandatory for every account and cannot be turned off from here. If you lose your
      device, ask an administrator to reset your 2FA so you can go through setup again.
    </p>

    <button class="btn btn-secondary" on:click={regenerate} disabled={regenerating}>
      {regenerating ? 'Generating…' : 'Regenerate backup codes'}
    </button>

    <div style="margin-top:1.5rem;">
      {#if $authStore.user?.hasPassword}
        <a href="#/change-password">Change password</a>
      {:else}
        <p class="hint" style="margin:0;">
          This account signs in via an external provider (SSO) and has no local password to change.
        </p>
      {/if}
    </div>
  </div>
</div>
