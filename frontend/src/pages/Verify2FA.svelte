<script>
  import { push } from 'svelte-spa-router';
  import { api, ApiError } from '../lib/api.js';
  import { authStore } from '../lib/stores/auth.js';

  let code = '';
  let error = '';
  let submitting = false;

  async function handleSubmit() {
    error = '';
    submitting = true;
    try {
      const result = await api.verifyTwoFactor(code);
      await authStore.refresh();
      push(result.mustChangePassword ? '/change-password' : '/dashboard');
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Invalid verification code.';
    } finally {
      submitting = false;
    }
  }
</script>

<div class="page page-narrow">
  <div class="card">
    <h1>Two-factor verification</h1>
    <p class="subtitle">Enter the 6-digit code from your authenticator app, or one of your backup codes.</p>

    {#if error}
      <div class="alert alert-error">{error}</div>
    {/if}

    <form on:submit|preventDefault={handleSubmit}>
      <div class="field">
        <label for="code">Verification code</label>
        <input
          id="code"
          bind:value={code}
          autocomplete="one-time-code"
          required
          placeholder="123456 or XXXX-XXXX"
        />
      </div>
      <button class="btn btn-block" type="submit" disabled={submitting}>
        {submitting ? 'Verifying…' : 'Verify'}
      </button>
    </form>
  </div>
</div>
