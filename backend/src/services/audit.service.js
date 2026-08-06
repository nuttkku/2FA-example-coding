import { pool } from '../config/db.js';

export async function recordEvent({ userId = null, eventType, metadata = {}, ipAddress = null }) {
  await pool.query(
    `INSERT INTO audit_logs (user_id, event_type, metadata, ip_address) VALUES ($1, $2, $3, $4)`,
    [userId, eventType, metadata, ipAddress],
  );
}

export async function listEvents({ limit = 50, offset = 0 }) {
  const { rows } = await pool.query(
    `SELECT a.id, a.event_type, a.metadata, a.ip_address, a.created_at,
            u.email AS user_email
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return rows;
}
