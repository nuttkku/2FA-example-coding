import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),

  // "false" by default: this docker-compose setup exposes the backend port directly,
  // with no reverse proxy in front of it. Trusting X-Forwarded-For with no real proxy
  // there to set it would let any client spoof req.ip, defeating IP-based rate
  // limiting/lockout and forging the audit log's ip_address. Only set this (to a hop
  // count like "1", or a specific proxy IP/subnet) if you put a real reverse proxy
  // in front of the backend.
  TRUST_PROXY: z.string().default('false'),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().default(5432),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_NAME: z.string().min(1),

  ACCESS_TOKEN_SECRET: z.string().min(16, 'ACCESS_TOKEN_SECRET must be set to a long random value'),
  REFRESH_TOKEN_SECRET: z.string().min(16, 'REFRESH_TOKEN_SECRET must be set to a long random value'),
  PRE_AUTH_TOKEN_SECRET: z.string().min(16, 'PRE_AUTH_TOKEN_SECRET must be set to a long random value'),
  SSO_STATE_SECRET: z.string().min(16, 'SSO_STATE_SECRET must be set to a long random value'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL: z.string().default('7d'),
  PRE_AUTH_TOKEN_TTL: z.string().default('5m'),

  TOTP_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'TOTP_ENCRYPTION_KEY must be 64 hex characters (32 bytes)'),
  TWOFA_ISSUER: z.string().default('2FA Example'),

  COOKIE_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  FRONTEND_ORIGIN: z.string().default('http://localhost:5173'),

  LOGIN_MAX_ATTEMPTS: z.coerce.number().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().default(15),

  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD: z.string().min(8),
  ADMIN_FULL_NAME: z.string().default('System Administrator'),

  // Seeded alongside the admin account purely so there's a ready-made plain
  // "user" role login for testing/demoing RBAC without having to create one
  // by hand first. Has a default (unlike ADMIN_EMAIL/PASSWORD, which are
  // required with no default) since this account is a convenience, not a
  // required bootstrap step - remove/change it before any real deployment.
  TEST_USER_EMAIL: z.string().email().default('user@example.com'),
  TEST_USER_PASSWORD: z.string().min(8).default('UserTest123'),
  TEST_USER_FULL_NAME: z.string().default('Test User'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';
