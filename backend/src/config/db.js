import { Pool } from 'pg';
import { env } from './env.js';

export const pool = new Pool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  max: 10,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error', err);
});
