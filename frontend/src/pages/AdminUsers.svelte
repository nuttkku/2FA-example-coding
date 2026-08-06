<script>
  import { onMount } from 'svelte';
  import { authStore } from '../lib/stores/auth.js';
  import { api, ApiError } from '../lib/api.js';

  const ROLES = ['admin', 'manager', 'user'];

  let users = [];
  let search = '';
  let loading = true;
  let error = '';
  let info = '';

  let showCreateModal = false;
  let newUser = { email: '', fullName: '', role: 'user', temporaryPassword: '' };
  let creating = false;

  let resetPasswordTarget = null;
  let resettingPassword = false;

  $: isAdmin = $authStore.user?.role === 'admin';

  function generateTempPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const bytes = crypto.getRandomValues(new Uint32Array(12));
    let result = 'Temp-';
    bytes.forEach((n) => (result += chars[n % chars.length]));
    return result;
  }

  async function loadUsers() {
    loading = true;
    error = '';
    try {
      const result = await api.admin.listUsers(search);
      users = result.users;
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Could not load users.';
    } finally {
      loading = false;
    }
  }

  onMount(loadUsers);

  function openCreateModal() {
    newUser = { email: '', fullName: '', role: 'user', temporaryPassword: generateTempPassword() };
    showCreateModal = true;
  }

  async function submitCreateUser() {
    creating = true;
    error = '';
    try {
      await api.admin.createUser(newUser);
      showCreateModal = false;
      info = `User created. Share this temporary password with them: ${newUser.temporaryPassword}`;
      await loadUsers();
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Could not create user.';
    } finally {
      creating = false;
    }
  }

  async function changeRole(user, role) {
    error = '';
    try {
      await api.admin.updateUser(user.id, { role });
      await loadUsers();
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Could not update role.';
      await loadUsers();
    }
  }

  async function toggleStatus(user) {
    error = '';
    try {
      await api.admin.updateUser(user.id, { status: user.status === 'active' ? 'disabled' : 'active' });
      await loadUsers();
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Could not update status.';
    }
  }

  function openResetPassword(user) {
    resetPasswordTarget = { ...user, temporaryPassword: generateTempPassword() };
  }

  async function submitResetPassword() {
    resettingPassword = true;
    error = '';
    try {
      await api.admin.resetPassword(resetPasswordTarget.id, resetPasswordTarget.temporaryPassword);
      info = `Password reset. Share this temporary password with them: ${resetPasswordTarget.temporaryPassword}`;
      resetPasswordTarget = null;
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Could not reset password.';
    } finally {
      resettingPassword = false;
    }
  }

  async function resetTwoFactor(user) {
    if (!confirm(`Reset 2FA for ${user.email}? They will be forced through setup again on next login.`)) return;
    error = '';
    try {
      await api.admin.resetTwoFactor(user.id);
      info = `2FA reset for ${user.email}.`;
      await loadUsers();
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Could not reset 2FA.';
    }
  }
</script>

<div class="page">
  <div class="toolbar">
    <div>
      <h1>Users</h1>
      <p class="subtitle" style="margin-bottom:0;">Manage accounts, roles, and 2FA enrollment.</p>
    </div>
    {#if isAdmin}
      <button class="btn" on:click={openCreateModal}>+ New user</button>
    {/if}
  </div>

  {#if error}
    <div class="alert alert-error">{error}</div>
  {/if}
  {#if info}
    <div class="alert alert-success">{info}</div>
  {/if}

  <div class="card">
    <form class="row" style="margin-bottom:1rem;" on:submit|preventDefault={loadUsers}>
      <input placeholder="Search by name or email…" bind:value={search} style="max-width:280px;" />
      <button class="btn btn-secondary" type="submit">Search</button>
    </form>

    {#if loading}
      <p>Loading users…</p>
    {:else}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Sign-in</th>
              <th>Role</th>
              <th>Status</th>
              <th>2FA</th>
              {#if isAdmin}<th>Actions</th>{/if}
            </tr>
          </thead>
          <tbody>
            {#each users as user (user.id)}
              <tr>
                <td>{user.full_name}</td>
                <td>{user.email}</td>
                <td>{user.has_password ? 'Password' : 'SSO only'}</td>
                <td>
                  {#if isAdmin}
                    <select value={user.role} on:change={(e) => changeRole(user, e.target.value)}>
                      {#each ROLES as role}
                        <option value={role}>{role}</option>
                      {/each}
                    </select>
                  {:else}
                    <span class="badge badge-{user.role}">{user.role}</span>
                  {/if}
                </td>
                <td><span class="badge badge-{user.status}">{user.status}</span></td>
                <td>{user.totp_enabled ? '✅ enabled' : '⏳ pending setup'}</td>
                {#if isAdmin}
                  <td>
                    <div class="row">
                      <button class="btn btn-secondary btn-sm" on:click={() => toggleStatus(user)}>
                        {user.status === 'active' ? 'Disable' : 'Enable'}
                      </button>
                      <button class="btn btn-secondary btn-sm" on:click={() => openResetPassword(user)}>
                        Reset password
                      </button>
                      <button class="btn btn-secondary btn-sm" on:click={() => resetTwoFactor(user)}>
                        Reset 2FA
                      </button>
                    </div>
                  </td>
                {/if}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</div>

{#if showCreateModal}
  <div class="modal-backdrop" on:click|self={() => (showCreateModal = false)}>
    <div class="modal">
      <h2>Create user</h2>
      <form on:submit|preventDefault={submitCreateUser}>
        <div class="field">
          <label for="new-email">Email</label>
          <input id="new-email" type="email" bind:value={newUser.email} required />
        </div>
        <div class="field">
          <label for="new-name">Full name</label>
          <input id="new-name" bind:value={newUser.fullName} required />
        </div>
        <div class="field">
          <label for="new-role">Role</label>
          <select id="new-role" bind:value={newUser.role}>
            {#each ROLES as role}
              <option value={role}>{role}</option>
            {/each}
          </select>
        </div>
        <div class="field">
          <label for="new-password">Temporary password</label>
          <input id="new-password" bind:value={newUser.temporaryPassword} required />
          <p class="hint">The new user must change this and complete 2FA setup on first login.</p>
        </div>
        <div class="row">
          <button class="btn" type="submit" disabled={creating}>{creating ? 'Creating…' : 'Create user'}</button>
          <button class="btn btn-secondary" type="button" on:click={() => (showCreateModal = false)}>Cancel</button>
        </div>
      </form>
    </div>
  </div>
{/if}

{#if resetPasswordTarget}
  <div class="modal-backdrop" on:click|self={() => (resetPasswordTarget = null)}>
    <div class="modal">
      <h2>Reset password for {resetPasswordTarget.email}</h2>
      <form on:submit|preventDefault={submitResetPassword}>
        <div class="field">
          <label for="reset-password">Temporary password</label>
          <input id="reset-password" bind:value={resetPasswordTarget.temporaryPassword} required />
          <p class="hint">They must change this on next login (existing sessions are revoked).</p>
        </div>
        <div class="row">
          <button class="btn" type="submit" disabled={resettingPassword}>
            {resettingPassword ? 'Saving…' : 'Reset password'}
          </button>
          <button class="btn btn-secondary" type="button" on:click={() => (resetPasswordTarget = null)}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}
