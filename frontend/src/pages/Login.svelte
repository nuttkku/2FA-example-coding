<script>
  import { onMount } from 'svelte';
  import { push } from 'svelte-spa-router';
  import { api, ApiError } from '../lib/api.js';

  const SSO_ERROR_MESSAGES = {
    unknown_provider: 'That sign-in method is not available.',
    sso_expired: 'That sign-in attempt expired, please try again.',
    sso_denied: 'Sign-in was cancelled or denied by the provider.',
    sso_failed: 'Sign-in failed, please try again.',
  };

  let email = '';
  let password = '';
  let error = '';
  let loading = false;
  let providers = [];

  onMount(async () => {
    const hash = window.location.hash;
    const queryIndex = hash.indexOf('?');
    if (queryIndex !== -1) {
      const params = new URLSearchParams(hash.slice(queryIndex + 1));
      const ssoError = params.get('error');
      if (ssoError) {
        error = SSO_ERROR_MESSAGES[ssoError] || 'Sign-in failed, please try again.';
        history.replaceState(null, '', window.location.pathname + window.location.search + '#/login');
      }
    }

    try {
      const result = await api.sso.listProviders();
      providers = result.providers;
    } catch {
      providers = [];
    }
  });

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

    {#if providers.length > 0}
      <div class="stack" style="margin-top:1.25rem; padding-top:1.25rem; border-top:1px solid var(--color-border);">
        <p class="hint" style="margin:0 0 0.25rem;">Or continue with</p>
        {#each providers as provider (provider.id)}
          <a class="btn btn-secondary btn-block" href={api.sso.startUrl(provider.id)}>{provider.label}</a>
        {/each}
      </div>
    {/if}
  </div>
</div>
