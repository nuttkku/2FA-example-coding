<script>
  import { push } from 'svelte-spa-router';
  import { api, ApiError } from '../lib/api.js';

  let email = '';
  let password = '';
  let error = '';
  let loading = false;

  async function handleSubmit() {
    error = '';
    loading = true;
    try {
      const result = await api.login(email, password);
      if (result.stage === 'setup_required') {
        push('/2fa/setup');
      } else {
        push('/2fa/verify');
      }
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';
    } finally {
      loading = false;
    }
  }
</script>

<div class="page page-narrow">
  <div class="card">
    <h1>Sign in</h1>
    <p class="subtitle">Every account requires a second verification step after your password.</p>

    {#if error}
      <div class="alert alert-error">{error}</div>
    {/if}

    <form on:submit|preventDefault={handleSubmit}>
      <div class="field">
        <label for="email">Email</label>
        <input id="email" type="email" bind:value={email} required autocomplete="username" />
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input id="password" type="password" bind:value={password} required autocomplete="current-password" />
      </div>
      <button class="btn btn-block" type="submit" disabled={loading}>
        {loading ? 'Signing in…' : 'Continue'}
      </button>
    </form>
  </div>
</div>
