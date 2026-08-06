import { pool } from '../config/db.js';

const PUBLIC_COLUMNS = `
  id, email, full_name, role, status, totp_enabled, must_change_password,
  failed_login_attempts, locked_until, created_at, updated_at
`;

export async function findByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  return rows[0] ?? null;
}

export async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function listUsers({ search, limit = 50, offset = 0 }) {
  const { rows } = await pool.query(
    `SELECT ${PUBLIC_COLUMNS} FROM users
     WHERE $1::text IS NULL OR email ILIKE '%' || $1 || '%' OR full_name ILIKE '%' || $1 || '%'
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [search ?? null, limit, offset],
  );
  return rows;
}

export async function createUser({ email, fullName, passwordHash, role }) {
  const { rows } = await pool.query(
    `INSERT INTO users (email, full_name, password_hash, role, must_change_password)
     VALUES ($1, $2, $3, $4, TRUE)
     RETURNING ${PUBLIC_COLUMNS}`,
    [email.toLowerCase(), fullName, passwordHash, role],
  );
  return rows[0];
}

export async function updateRoleAndStatus(id, { role, status }) {
  const { rows } = await pool.query(
    `UPDATE users SET
       role = COALESCE($2, role),
       status = COALESCE($3, status),
       updated_at = now()
     WHERE id = $1
     RETURNING ${PUBLIC_COLUMNS}`,
    [id, role ?? null, status ?? null],
  );
  return rows[0] ?? null;
}

export async function setPasswordHash(id, passwordHash, { mustChangePassword = false } = {}) {
  await pool.query(
    `UPDATE users SET password_hash = $2, must_change_password = $3, updated_at = now() WHERE id = $1`,
    [id, passwordHash, mustChangePassword],
  );
}

export async function clearMustChangePassword(id) {
  await pool.query('UPDATE users SET must_change_password = FALSE, updated_at = now() WHERE id = $1', [id]);
}

export async function setTotpSecretPending(id, encryptedSecret) {
  await pool.query(
    'UPDATE users SET totp_secret_enc = $2, totp_enabled = FALSE, updated_at = now() WHERE id = $1',
    [id, encryptedSecret],
  );
}

export async function enableTotp(id) {
  await pool.query('UPDATE users SET totp_enabled = TRUE, updated_at = now() WHERE id = $1', [id]);
}

export async function resetTwoFactor(id) {
  await pool.query(
    'UPDATE users SET totp_enabled = FALSE, totp_secret_enc = NULL, updated_at = now() WHERE id = $1',
    [id],
  );
  await pool.query('DELETE FROM backup_codes WHERE user_id = $1', [id]);
}

export async function recordFailedLogin(id, { maxAttempts, lockMinutes }) {
  const { rows } = await pool.query(
    `UPDATE users SET
       failed_login_attempts = failed_login_attempts + 1,
       locked_until = CASE
         WHEN failed_login_attempts + 1 >= $2 THEN now() + ($3 || ' minutes')::interval
         ELSE locked_until
       END,
       updated_at = now()
     WHERE id = $1
     RETURNING failed_login_attempts, locked_until`,
    [id, maxAttempts, lockMinutes],
  );
  return rows[0];
}

export async function resetFailedLogins(id) {
  await pool.query(
    'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = $1',
    [id],
  );
}
