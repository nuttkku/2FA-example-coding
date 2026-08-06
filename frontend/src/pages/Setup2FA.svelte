<script>
  import { onMount } from 'svelte';
  import { push } from 'svelte-spa-router';
  import { api, ApiError } from '../lib/api.js';
  import { authStore } from '../lib/stores/auth.js';
  import { pendingBackupCodes } from '../lib/stores/backupCodes.js';

  let qrCodeDataUrl = '';
  let secret = '';
  let code = '';
  let error = '';
  let loading = true;
  let submitting = false;

  onMount(async () => {
    try {
      const result = await api.setupTwoFactor();
      qrCodeDataUrl = result.qrCodeDataUrl;
      secret = result.secret;
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Could not start 2FA setup.';
      if (err instanceof ApiError && err.status === 401) {
        setTimeout(() => push('/login'), 1500);
      }
    } finally {
      loading = false;
    }
  });

  async function handleSubmit() {
    error = '';
    submitting = true;
    try {
      const result = await api.confirmTwoFactorSetup(code);
      await authStore.refresh();
      pendingBackupCodes.set({
        codes: result.backupCodes,
        nextRoute: result.mustChangePassword ? '/change-password' : '/dashboard',
      });
      push('/2fa/backup-codes');
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Invalid verification code.';
    } finally {
      submitting = false;
    }
  }
</script>

<div class="page page-narrow">
  <div class="card">
    <h1>Set up two-factor authentication</h1>
    <p class="subtitle">
      This account has not completed 2FA setup yet. Scan the QR code below with an authenticator
      app (Google Authenticator, Authy, 1Password, …) - every account must finish this step before
      it can sign in.
    </p>

    {#if error}
      <div class="alert alert-error">{error}</div>
    {/if}

    {#if loading}
      <p>Generating your secret…</p>
    {:else}
      <div class="stack" style="align-items:center; margin-bottom:1.25rem;">
        <img src={qrCodeDataUrl} alt="Scan this QR code with your authenticator app" width="200" height="200" />
      </div>
      <p class="hint">Can't scan the code? Enter this secret manually:</p>
      <div class="code-block" style="margin-bottom:1.25rem;">{secret}</div>

      <form on:submit|preventDefault={handleSubmit}>
        <div class="field">
          <label for="code">6-digit code</label>
          <input
            id="code"
            bind:value={code}
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            required
          />
        </div>
        <button class="btn btn-block" type="submit" disabled={submitting}>
          {submitting ? 'Verifying…' : 'Enable 2FA'}
        </button>
      </form>
    {/if}
  </div>
</div>
