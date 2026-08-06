<script>
  import { push } from 'svelte-spa-router';
  import { pendingBackupCodes } from '../lib/stores/backupCodes.js';

  function continueOn() {
    const nextRoute = $pendingBackupCodes?.nextRoute || '/dashboard';
    pendingBackupCodes.set(null);
    push(nextRoute);
  }
</script>

<div class="page page-narrow">
  <div class="card">
    <h1>Save your backup codes</h1>

    {#if !$pendingBackupCodes}
      <p class="subtitle">
        These codes are no longer available to view. If you still need them, ask an administrator
        to reset your 2FA.
      </p>
      <button class="btn btn-block" on:click={() => push('/dashboard')}>Go to dashboard</button>
    {:else}
      <p class="subtitle">
        Each code below can be used once, in place of your authenticator app, if you lose access to
        it. Store them somewhere safe - they will not be shown again.
      </p>
      <div class="backup-codes-grid">
        {#each $pendingBackupCodes.codes as backupCode}
          <div>{backupCode}</div>
        {/each}
      </div>
      <button class="btn btn-block" on:click={continueOn}>I've saved these codes</button>
    {/if}
  </div>
</div>
