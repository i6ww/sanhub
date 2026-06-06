#!/bin/sh
set -e

is_production() {
  [ "$NODE_ENV" = "production" ]
}

require_production_secret() {
  name="$1"
  value="$2"

  if [ -z "$value" ]; then
    echo "[SanHub] ERROR: $name is required in production."
    exit 1
  fi
}

reject_production_value() {
  name="$1"
  value="$2"
  weak_value="$3"

  if [ "$value" = "$weak_value" ]; then
    echo "[SanHub] ERROR: $name uses the default weak value in production."
    echo "[SanHub] Please set a strong value in your .env file before starting."
    exit 1
  fi
}

reject_short_secret() {
  name="$1"
  value="$2"
  min_length="$3"
  length=${#value}

  if [ "$length" -lt "$min_length" ]; then
    echo "[SanHub] ERROR: $name is too short for production."
    echo "[SanHub] Please use at least $min_length characters."
    exit 1
  fi
}

# Auto-generate NEXTAUTH_SECRET if not provided.
if [ -z "$NEXTAUTH_SECRET" ]; then
  if is_production; then
    echo "[SanHub] ERROR: NEXTAUTH_SECRET is required in production."
    echo "[SanHub] Generate one with: openssl rand -hex 32"
    exit 1
  else
    export NEXTAUTH_SECRET=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
    echo "[SanHub] Auto-generated NEXTAUTH_SECRET"
  fi
fi

# Auto-detect NEXTAUTH_URL if not provided.
if [ -z "$NEXTAUTH_URL" ]; then
  export NEXTAUTH_URL="http://localhost:3001"
  echo "[SanHub] Using default NEXTAUTH_URL: $NEXTAUTH_URL"
fi

# Set default admin credentials if not provided.
if [ -z "$ADMIN_EMAIL" ]; then
  export ADMIN_EMAIL="admin@sanhub.local"
  echo "[SanHub] Using default ADMIN_EMAIL: $ADMIN_EMAIL"
fi

if [ -z "$ADMIN_PASSWORD" ]; then
  if is_production; then
    echo "[SanHub] ERROR: ADMIN_PASSWORD is required in production."
    exit 1
  else
    export ADMIN_PASSWORD="sanhub123"
    echo "[SanHub] Using default ADMIN_PASSWORD: sanhub123"
    echo "[SanHub] Please change the admin password after first login."
  fi
fi

if is_production; then
  require_production_secret "MYSQL_PASSWORD" "$MYSQL_PASSWORD"
  require_production_secret "MYSQL_ROOT_PASSWORD" "$MYSQL_ROOT_PASSWORD"
  reject_short_secret "NEXTAUTH_SECRET" "$NEXTAUTH_SECRET" 32
  reject_short_secret "ADMIN_PASSWORD" "$ADMIN_PASSWORD" 12
  reject_short_secret "MYSQL_PASSWORD" "$MYSQL_PASSWORD" 12
  reject_short_secret "MYSQL_ROOT_PASSWORD" "$MYSQL_ROOT_PASSWORD" 12
  reject_production_value "NEXTAUTH_SECRET" "$NEXTAUTH_SECRET" "your-nextauth-secret-key-here"
  reject_production_value "ADMIN_PASSWORD" "$ADMIN_PASSWORD" "sanhub123"
  reject_production_value "ADMIN_PASSWORD" "$ADMIN_PASSWORD" "change-this-password"
  reject_production_value "MYSQL_PASSWORD" "$MYSQL_PASSWORD" "sanhub_password"
  reject_production_value "MYSQL_PASSWORD" "$MYSQL_PASSWORD" "your-mysql-password"
  reject_production_value "MYSQL_ROOT_PASSWORD" "$MYSQL_ROOT_PASSWORD" "sanhub_root_password"
  reject_production_value "MYSQL_ROOT_PASSWORD" "$MYSQL_ROOT_PASSWORD" "your-mysql-root-password"
fi

echo "[SanHub] Starting server..."
exec "$@"
