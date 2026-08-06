import { pool } from '../config/db.js';
import { env } from '../config/env.js';
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

if (import.meta.url === `file://${process.argv[1]}`) {
  seedAdmin()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error('Seeding failed', err);
      process.exit(1);
    });
}
