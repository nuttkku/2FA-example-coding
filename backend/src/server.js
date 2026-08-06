import { env } from './config/env.js';
import { app } from './app.js';
import { runMigrations } from './db/migrate.js';
import { seedAdmin } from './db/seed.js';
import { logger } from './utils/logger.js';

async function main() {
  await runMigrations();
  await seedAdmin();

  app.listen(env.PORT, () => {
    logger.info(`Backend listening on port ${env.PORT} (${env.NODE_ENV})`);
  });
}

main().catch((err) => {
  logger.error('Failed to start server', err);
  process.exit(1);
});
