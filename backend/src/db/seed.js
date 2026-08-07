import { pool } from '../config/db.js';
import { env, isProduction } from '../config/env.js';
import { hashSecret } from '../utils/password.js';
import { logger } from '../utils/logger.js';

export async function seedAdmin() {
  const { rows } = await pool.query('SELECT id FROM users WHERE role = $1 LIMIT 1', ['admin']);
  if (rows.length > 0) {
    logger.info('Admin user already exists, skipping bootstrap seed');
    return;
  }

  const passwordHash = await hashSecret(env.ADMIN_PASSWORD);

  await pool.query(
    `INSERT INTO users (email, full_name, password_hash, role, must_change_password)
     VALUES ($1, $2, $3, 'admin', TRUE)
     ON CONFLICT (email) DO NOTHING`,
    [env.ADMIN_EMAIL.toLowerCase(), env.ADMIN_FULL_NAME, passwordHash],
  );

  logger.info(`Bootstrap admin account ready: ${env.ADMIN_EMAIL} (2FA setup + password change required on first login)`);
}

// Convenience seed so there's a ready-made plain "user" role account for
// testing/demoing RBAC (e.g. confirming the admin-only menus stay hidden)
// without having to create one by hand first. Keyed by this specific email
// rather than "does any user role exist" like seedAdmin, since regular users
// are expected to accumulate normally and shouldn't block re-seeding logic.
//
// Skipped entirely when NODE_ENV=production: this account exists purely for
// local testing/demos, unlike the admin account there is no bootstrap need
// for it, so a real deployment should never get it auto-created into its
// database in the first place - not even once, not even to be deleted later.
export async function seedTestUser() {
  if (isProduction) {
    logger.info('NODE_ENV=production: skipping test user seed (this account is for testing only)');
    return;
  }

  const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [env.TEST_USER_EMAIL.toLowerCase()]);
  if (rows.length > 0) {
    logger.info('Test user account already exists, skipping seed');
    return;
  }

  const passwordHash = await hashSecret(env.TEST_USER_PASSWORD);

  await pool.query(
    `INSERT INTO users (email, full_name, password_hash, role, must_change_password)
     VALUES ($1, $2, $3, 'user', FALSE)
     ON CONFLICT (email) DO NOTHING`,
    [env.TEST_USER_EMAIL.toLowerCase(), env.TEST_USER_FULL_NAME, passwordHash],
  );

  logger.info(`Test user account ready: ${env.TEST_USER_EMAIL} (2FA setup required on first login)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  Promise.resolve()
    .then(() => seedAdmin())
    .then(() => seedTestUser())
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error('Seeding failed', err);
      process.exit(1);
    });
}
