#!/usr/bin/env bash
# Copies each .env.example to .env (if missing) and fills in every secret
# placeholder with a freshly generated random value. Safe to re-run - it never
# overwrites a .env file that already exists, and only touches lines that
# still hold the shipped placeholder text, so custom values you've already
# set are left alone.
set -euo pipefail
cd "$(dirname "$0")/.."

copy_if_missing() {
  if [ ! -f "$2" ]; then
    cp "$1" "$2"
    echo "created $2"
  else
    echo "$2 already exists, leaving it alone"
  fi
}

copy_if_missing .env.example .env
copy_if_missing backend/.env.example backend/.env
copy_if_missing frontend/.env.example frontend/.env

fill_secret() {
  local file="$1" key="$2" bytes="$3"
  local value
  value=$(openssl rand -hex "$bytes")
  if grep -q "^${key}=replace_with_output_of_openssl_rand_hex_${bytes}\$" "$file"; then
    sed -i.bak "s|^${key}=replace_with_output_of_openssl_rand_hex_${bytes}\$|${key}=${value}|" "$file"
    rm -f "${file}.bak"
    echo "generated $key in $file"
  fi
}

fill_secret backend/.env ACCESS_TOKEN_SECRET 64
fill_secret backend/.env REFRESH_TOKEN_SECRET 64
fill_secret backend/.env PRE_AUTH_TOKEN_SECRET 64
fill_secret backend/.env SSO_STATE_SECRET 64
fill_secret backend/.env TOTP_ENCRYPTION_KEY 32

echo "Done. Review backend/.env and .env before running docker compose (database password, admin credentials, SSO provider settings)."
