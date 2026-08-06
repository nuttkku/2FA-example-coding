<script>
  import { onMount } from 'svelte';
  import { api, ApiError } from '../lib/api.js';

  let events = [];
  let loading = true;
  let error = '';

  onMount(async () => {
    try {
      const result = await api.admin.auditLogs();
      events = result.events;
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Could not load audit log.';
    } finally {
      loading = false;
    }
  });

  function formatTime(value) {
    return new Date(value).toLocaleString();
  }
</script>

<div class="page">
  <h1>Audit log</h1>
  <p class="subtitle">Login attempts, 2FA events, and admin actions - most recent first.</p>

  {#if error}
    <div class="alert alert-error">{error}</div>
  {/if}

  <div class="card">
    {#if loading}
      <p>Loading…</p>
    {:else}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Event</th>
              <th>User</th>
              <th>IP</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {#each events as event (event.id)}
              <tr>
                <td>{formatTime(event.created_at)}</td>
                <td>{event.event_type}</td>
                <td>{event.user_email || '—'}</td>
                <td>{event.ip_address || '—'}</td>
                <td>{Object.keys(event.metadata || {}).length ? JSON.stringify(event.metadata) : '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</div>
