#!/usr/bin/env bash
# End-to-end smoke test for the forced-2FA login flow and RBAC, run against a
# live stack (docker compose up must already have completed). Exercises the
# same sequence used to validate this app by hand during development:
# forced setup -> backup codes -> session -> password change ends other
# sessions -> refresh-token reuse detection -> TOTP replay rejected -> backup
# codes are single-use -> backup-code regeneration needs TOTP step-up -> RBAC 403 for a plain user -> logout -> 401 ->
# per-account 2FA lockout. Exits non-zero on the first assertion failure.
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:5173}"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
cd "$WORKDIR"

ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-change_me_immediately!1}"

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1" >&2; exit 1; }

json_get() {
  node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(String(d.$1 ?? ''))"
}

totp_code() {
  node -e '
    const crypto = require("crypto");
    const secret = process.argv[1];
    function base32Decode(input) {
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
      let bits = "";
      for (const char of input.toUpperCase().replace(/=+$/, "")) {
        const val = alphabet.indexOf(char);
        if (val === -1) continue;
        bits += val.toString(2).padStart(5, "0");
      }
      const bytes = [];
      for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.substring(i, i + 8), 2));
      return Buffer.from(bytes);
    }
    const key = base32Decode(secret);
    const counter = Math.floor(Date.now() / 1000 / 30);
    const buf = Buffer.alloc(8);
    buf.writeBigInt64BE(BigInt(counter));
    const hmac = crypto.createHmac("sha1", key).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0xf;
    const code = ((hmac[offset] & 0x7f) << 24 | (hmac[offset+1] & 0xff) << 16 | (hmac[offset+2] & 0xff) << 8 | (hmac[offset+3] & 0xff)) % 1000000;
    process.stdout.write(code.toString().padStart(6, "0"));
  ' "$1"
}

echo "--- health check ---"
curl -sf "$BASE_URL/api/health" > /dev/null || fail "backend health check"
pass "backend healthy"

echo "--- bootstrap admin: forced 2FA setup ---"
LOGIN=$(curl -s -c admin_cookies.txt -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
  "$BASE_URL/api/auth/login")
[ "$(echo "$LOGIN" | json_get stage)" = "setup_required" ] || fail "expected setup_required, got: $LOGIN"
pass "password login forces 2FA setup stage"

SETUP=$(curl -s -b admin_cookies.txt -c admin_cookies.txt -X POST "$BASE_URL/api/auth/2fa/setup")
SECRET=$(echo "$SETUP" | json_get secret)
[ -n "$SECRET" ] || fail "no TOTP secret returned"

CODE=$(totp_code "$SECRET")
CONFIRM=$(curl -s -b admin_cookies.txt -c admin_cookies.txt -H "Content-Type: application/json" \
  -d "{\"code\":\"$CODE\"}" "$BASE_URL/api/auth/2fa/setup/confirm")
[ "$(echo "$CONFIRM" | json_get stage)" = "complete" ] || fail "2FA setup confirm failed: $CONFIRM"
echo "$CONFIRM" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));if(!Array.isArray(d.backupCodes)||d.backupCodes.length!==10)process.exit(1)' \
  || fail "expected 10 backup codes"
pass "2FA setup completed, session issued, 10 backup codes returned"
BACKUP_CODE_1=$(echo "$CONFIRM" | json_get "backupCodes[0]")
BACKUP_CODE_2=$(echo "$CONFIRM" | json_get "backupCodes[1]")
BACKUP_CODE_3=$(echo "$CONFIRM" | json_get "backupCodes[2]")

ME=$(curl -s -b admin_cookies.txt "$BASE_URL/api/auth/me")
[ "$(echo "$ME" | json_get user.role)" = "admin" ] || fail "expected admin role: $ME"
pass "authenticated session confirms admin role"

NEW_PASSWORD="SmokeTestPass123"
cp admin_cookies.txt admin_other_device.txt
curl -s -b admin_cookies.txt -c admin_cookies.txt -H "Content-Type: application/json" \
  -d "{\"currentPassword\":\"$ADMIN_PASSWORD\",\"newPassword\":\"$NEW_PASSWORD\"}" \
  "$BASE_URL/api/auth/change-password" | json_get ok | grep -q true || fail "change-password failed"
pass "forced password change succeeded"

STATUS=$(curl -s -o /dev/null -w '%{http_code}' -b admin_other_device.txt -X POST "$BASE_URL/api/auth/refresh")
[ "$STATUS" = "401" ] || fail "expected 401 refreshing a session from before the password change, got $STATUS"
pass "password change revokes the account's other sessions"

echo "--- refresh token rotation: reuse of a rotated token revokes the session family ---"
cp admin_cookies.txt admin_stale.txt
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -b admin_cookies.txt -c admin_cookies.txt -X POST "$BASE_URL/api/auth/refresh")
[ "$STATUS" = "200" ] || fail "expected 200 on first refresh, got $STATUS"
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -b admin_stale.txt -X POST "$BASE_URL/api/auth/refresh")
[ "$STATUS" = "401" ] || fail "expected 401 reusing an already-rotated refresh token, got $STATUS"
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -b admin_cookies.txt -X POST "$BASE_URL/api/auth/refresh")
[ "$STATUS" = "401" ] || fail "expected the newest refresh token to be revoked too after reuse, got $STATUS"
pass "reused refresh token is rejected and revokes every session of that user"

echo "--- 2FA verify: TOTP replay rejected, backup codes single-use ---"
admin_login() {
  rm -f admin_cookies.txt
  local result
  result=$(curl -s -c admin_cookies.txt -H "Content-Type: application/json" \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$NEW_PASSWORD\"}" "$BASE_URL/api/auth/login")
  [ "$(echo "$result" | json_get stage)" = "verify_required" ] || fail "expected verify_required, got: $result"
}
verify_code() {
  curl -s -b admin_cookies.txt -c admin_cookies.txt -H "Content-Type: application/json" \
    -d "{\"code\":\"$1\"}" "$BASE_URL/api/auth/2fa/verify" | json_get stage
}

admin_login
[ "$(verify_code "$CODE")" != "complete" ] || fail "TOTP code already used during setup was accepted again (replay)"
pass "already-used TOTP code is rejected (replay protection)"
[ "$(verify_code "$BACKUP_CODE_1")" = "complete" ] || fail "login with a backup code failed"
pass "backup code completes 2FA"

admin_login
[ "$(verify_code "$BACKUP_CODE_1")" != "complete" ] || fail "backup code was accepted a second time"
pass "used backup code is rejected the second time"
[ "$(verify_code "$BACKUP_CODE_2")" = "complete" ] || fail "login with the second backup code failed"

echo "--- backup-code regeneration requires a fresh TOTP code (step-up) ---"
regenerate_codes() {
  curl -s -o /dev/null -w '%{http_code}' -b admin_cookies.txt -H "Content-Type: application/json" \
    -d "{\"code\":\"$1\"}" "$BASE_URL/api/auth/2fa/backup-codes/regenerate"
}
STATUS=$(regenerate_codes "$BACKUP_CODE_3")
[ "$STATUS" = "400" ] || fail "expected 400 regenerating backup codes with a backup code instead of TOTP, got $STATUS"
pass "session alone (plus a backup code) cannot regenerate backup codes"
# The setup code already claimed the current TOTP step, so wait for the next one.
sleep $(( 31 - $(date +%s) % 30 ))
STATUS=$(regenerate_codes "$(totp_code "$SECRET")")
[ "$STATUS" = "200" ] || fail "expected 200 regenerating backup codes with a valid TOTP code, got $STATUS"
pass "backup codes regenerated after TOTP step-up"

echo "--- RBAC: admin creates a plain user, plain user is denied admin routes ---"
TEST_EMAIL="smoketest-$(date +%s 2>/dev/null || echo static)@example.com"
CREATE=$(curl -s -b admin_cookies.txt -c admin_cookies.txt -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"fullName\":\"Smoke Test\",\"role\":\"user\",\"temporaryPassword\":\"TempPass123\"}" \
  "$BASE_URL/api/admin/users")
[ "$(echo "$CREATE" | json_get user.email)" = "$TEST_EMAIL" ] || fail "admin user creation failed: $CREATE"
pass "admin created a new user"

USER_LOGIN=$(curl -s -c user_cookies.txt -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"TempPass123\"}" "$BASE_URL/api/auth/login")
[ "$(echo "$USER_LOGIN" | json_get stage)" = "setup_required" ] || fail "new user should be forced into 2FA setup"

USER_SETUP=$(curl -s -b user_cookies.txt -c user_cookies.txt -X POST "$BASE_URL/api/auth/2fa/setup")
USER_SECRET=$(echo "$USER_SETUP" | json_get secret)
USER_CODE=$(totp_code "$USER_SECRET")
curl -s -b user_cookies.txt -c user_cookies.txt -H "Content-Type: application/json" \
  -d "{\"code\":\"$USER_CODE\"}" "$BASE_URL/api/auth/2fa/setup/confirm" | json_get stage | grep -q complete \
  || fail "new user 2FA setup confirm failed"
pass "new plain user completed forced 2FA setup"

STATUS=$(curl -s -o /dev/null -w '%{http_code}' -b user_cookies.txt "$BASE_URL/api/admin/users")
[ "$STATUS" = "403" ] || fail "expected 403 for plain user on /api/admin/users, got $STATUS"
pass "RBAC denies plain user access to admin routes (403)"

echo "--- logout invalidates session ---"
curl -s -b user_cookies.txt -c user_cookies.txt -X POST "$BASE_URL/api/auth/logout" | json_get ok | grep -q true \
  || fail "logout failed"
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -b user_cookies.txt "$BASE_URL/api/auth/me")
[ "$STATUS" = "401" ] || fail "expected 401 after logout, got $STATUS"
pass "logout invalidates the session"

echo "--- per-account 2FA lockout ---"
rm -f user_cookies.txt
curl -s -c user_cookies.txt -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"TempPass123\"}" "$BASE_URL/api/auth/login" \
  | json_get stage | grep -q verify_required || fail "expected verify_required for the plain user"
for _ in 1 2 3 4 5; do
  curl -s -o /dev/null -b user_cookies.txt -H "Content-Type: application/json" \
    -d '{"code":"ZZZZ-ZZZZ"}' "$BASE_URL/api/auth/2fa/verify"
done
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -b user_cookies.txt -H "Content-Type: application/json" \
  -d "{\"code\":\"$(totp_code "$USER_SECRET")\"}" "$BASE_URL/api/auth/2fa/verify")
[ "$STATUS" = "403" ] || fail "expected 403 (2FA locked) after 5 wrong codes, got $STATUS"
pass "5 wrong 2FA codes lock 2FA for that account"

echo ""
echo "All smoke tests passed."
