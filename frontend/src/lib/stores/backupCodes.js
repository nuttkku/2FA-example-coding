import { writable } from 'svelte/store';

// Backup codes are only ever shown once, right after they're generated. This
// store holds them in memory only (never persisted) so a page reload on the
// backup-codes screen loses them, same as if the tab had been closed.
export const pendingBackupCodes = writable(null);
