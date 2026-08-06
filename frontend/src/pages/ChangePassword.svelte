<script>
  import { push } from 'svelte-spa-router';
  import { api, ApiError } from '../lib/api.js';
  import { authStore } from '../lib/stores/auth.js';

  let currentPassword = '';
  let newPassword = '';
  let confirmPassword = '';
  let error = '';
  let submitting = false;

  async function handleSubmit() {
    error = '';
    if (newPassword !== confirmPassword) {
      error = 'Passwords do not match';
      return;
    }
    submitting = true;
    try {
      await api.changePassword(currentPassword, newPassword);
      await authStore.refresh();
      push('/dashboard');
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Something went wrong.';
    } finally {
      submitting = false;
    }
  }
</script>

<div class="page page-narrow">
  <div class="card">
    <h1>Change your password</h1>
    <p class="subtitle">This account was issued a temporary password and must set a new one before continuing.</p>

    {#if error}
      <div class="alert alert-error">{error}</div>
    {/if}

    <form on:submit|preventDefault={handleSubmit}>
      <div class="field">
        <label for="current">Current password</label>
        <input id="current" type="password" bind:value={currentPassword} required autocomplete="current-password" />
      </div>
      <div class="field">
        <label for="new">New password</label>
        <input id="new" type="password" bind:value={newPassword} required autocomplete="new-password" />
        <p class="hint">At least 10 characters, with a letter and a number.</p>
      </div>
      <div class="field">
        <label for="confirm">Confirm new password</label>
        <input id="confirm" type="password" bind:value={confirmPassword} required autocomplete="new-password" />
      </div>
      <button class="btn btn-block" type="submit" disabled={submitting}>
        {submitting ? 'Saving…' : 'Save password'}
      </button>
    </form>
  </div>
</div>
