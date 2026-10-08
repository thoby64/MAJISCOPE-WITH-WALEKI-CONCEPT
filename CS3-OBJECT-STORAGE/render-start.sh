#!/usr/bin/env bash
set -euo pipefail

SERVER_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
GARAGE_BINARY="$SERVER_DIR/.runtime/garage"
DATA_ROOT="${CS3_STORAGE_ROOT:-$SERVER_DIR/data}"
S3_PORT="${CS3_S3_PORT:-3901}"
UI_PORT="${PORT:-10000}"

: "${GARAGE_DEFAULT_ACCESS_KEY:?Set GARAGE_DEFAULT_ACCESS_KEY in Render}"
: "${GARAGE_DEFAULT_SECRET_KEY:?Set GARAGE_DEFAULT_SECRET_KEY in Render}"
: "${GARAGE_DEFAULT_BUCKET:?Set GARAGE_DEFAULT_BUCKET in Render}"
: "${CS3_UI_PASSPHRASE:?Set CS3_UI_PASSPHRASE in Render}"
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
api_bind_addr = "127.0.0.1:$S3_PORT"
root_domain = ".s3.localhost"

[admin]
api_bind_addr = "127.0.0.1:3903"
admin_token = "$admin_token"
metrics_token = "$metrics_token"
EOF
chmod 600 "$garage_config"

export GARAGE_CONFIG_FILE="$garage_config"
export GARAGE_DEFAULT_ACCESS_KEY GARAGE_DEFAULT_SECRET_KEY GARAGE_DEFAULT_BUCKET
export CS3_S3_ENDPOINT_URL="http://127.0.0.1:${S3_PORT}"
export CS3_UI_BIND_ADDRESS="0.0.0.0"
export CS3_UI_PORT="$UI_PORT"

"$GARAGE_BINARY" server --single-node --default-bucket &
GARAGE_PID=$!
WEBUI_PID=""
cleanup() {
  if [[ -n "$WEBUI_PID" ]]; then kill "$WEBUI_PID" 2>/dev/null || true; fi
  kill "$GARAGE_PID" 2>/dev/null || true
  if [[ -n "$WEBUI_PID" ]]; then wait "$WEBUI_PID" 2>/dev/null || true; fi
  wait "$GARAGE_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

ready=0
for _ in $(seq 1 60); do
  if ! kill -0 "$GARAGE_PID" 2>/dev/null; then
    echo "Garage exited before becoming ready." >&2
    exit 1
  fi
  if python -c 'import socket,sys;s=socket.socket();s.settimeout(.2);sys.exit(s.connect_ex(("127.0.0.1",int(sys.argv[1]))))' "$S3_PORT" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" != 1 ]]; then
  echo "Garage did not listen on 127.0.0.1:${S3_PORT} within 60 seconds." >&2
  exit 1
fi

echo "Browser and S3 endpoint listening on port ${UI_PORT}."
python "$SERVER_DIR/webui.py" &
WEBUI_PID=$!
wait "$WEBUI_PID"
