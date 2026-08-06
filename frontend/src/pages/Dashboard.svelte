<script>
  import { authStore } from '../lib/stores/auth.js';
</script>

<div class="page">
  <div class="card">
    <h1>Welcome, {$authStore.user?.fullName}</h1>
    <p class="subtitle">You are signed in with two-factor authentication verified.</p>
    <div class="row">
      <span class="badge badge-{$authStore.user?.role}">{$authStore.user?.role}</span>
      <span class="badge badge-active">2FA enabled</span>
    </div>
  </div>
</div>
