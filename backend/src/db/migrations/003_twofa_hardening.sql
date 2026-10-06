-- Last TOTP time-step (30s counter) accepted for this account. A code is only
-- accepted if its step is strictly greater than this, so a code that was already
-- used (e.g. shoulder-surfed or phished) cannot be replayed within its validity
-- window.
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_used_step BIGINT;

-- Per-account 2FA failure counter, deliberately separate from the password
-- lockout counter (failed_login_attempts/locked_until): the per-IP rate limiter
-- alone does not stop an attacker who already has the password from spreading
-- TOTP guesses across many IPs, and sharing the password counter would let
-- anyone who merely knows an SSO user's email lock them out of 2FA as well.
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_2fa_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS twofa_locked_until TIMESTAMPTZ;
