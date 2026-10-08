#!/usr/bin/env bash
set -euo pipefail

SERVER_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
GARAGE_BINARY="$SERVER_DIR/.runtime/garage"
DATA_ROOT="${CS3_STORAGE_ROOT:-/var/data}"
S3_PORT="${PORT:-10000}"

: "${GARAGE_DEFAULT_ACCESS_KEY:?Set GARAGE_DEFAULT_ACCESS_KEY in Render}"
: "${GARAGE_DEFAULT_SECRET_KEY:?Set GARAGE_DEFAULT_SECRET_KEY in Render}"
: "${GARAGE_DEFAULT_BUCKET:?Set GARAGE_DEFAULT_BUCKET in Render}"
if [[ ! -x "$GARAGE_BINARY" ]]; then
  echo "Garage binary is missing; run render-build.sh during the build." >&2
  exit 1
fi

mkdir -p "$DATA_ROOT/metadata" "$DATA_ROOT/objects" "$DATA_ROOT/runtime"
chmod 700 "$DATA_ROOT" "$DATA_ROOT/metadata" "$DATA_ROOT/objects" "$DATA_ROOT/runtime"
umask 077

load_or_create_secret() {
  local secret_file="$1"
  if [[ ! -s "$secret_file" ]]; then
    openssl rand -hex 32 > "$secret_file.tmp"
    chmod 600 "$secret_file.tmp"
    mv "$secret_file.tmp" "$secret_file"
  fi
  cat "$secret_file"
}

rpc_secret="$(load_or_create_secret "$DATA_ROOT/runtime/rpc.secret")"
admin_token="$(load_or_create_secret "$DATA_ROOT/runtime/admin.secret")"
metrics_token="$(load_or_create_secret "$DATA_ROOT/runtime/metrics.secret")"
garage_config="/tmp/cs3-garage-${PORT:-10000}.toml"

cat > "$garage_config" <<EOF
metadata_dir = "$DATA_ROOT/metadata"
data_dir = "$DATA_ROOT/objects"
db_engine = "sqlite"
replication_factor = 1
rpc_bind_addr = "127.0.0.1:3901"
rpc_public_addr = "127.0.0.1:3901"
rpc_secret = "$rpc_secret"

[s3_api]
s3_region = "garage"
api_bind_addr = "0.0.0.0:$S3_PORT"
root_domain = ".s3.localhost"

[admin]
api_bind_addr = "127.0.0.1:3903"
admin_token = "$admin_token"
metrics_token = "$metrics_token"
EOF
chmod 600 "$garage_config"

export GARAGE_CONFIG_FILE="$garage_config"
export GARAGE_DEFAULT_ACCESS_KEY GARAGE_DEFAULT_SECRET_KEY GARAGE_DEFAULT_BUCKET
exec "$GARAGE_BINARY" server --single-node --default-bucket
