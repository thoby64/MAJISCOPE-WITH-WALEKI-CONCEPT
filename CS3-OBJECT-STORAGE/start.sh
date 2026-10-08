#!/usr/bin/env bash
set -euo pipefail

SERVER_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SERVER_DIR"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example. Review the development credentials, then run ./start.sh again."
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a
: "${GARAGE_DEFAULT_ACCESS_KEY:?Set GARAGE_DEFAULT_ACCESS_KEY in .env}"
: "${GARAGE_DEFAULT_SECRET_KEY:?Set GARAGE_DEFAULT_SECRET_KEY in .env}"
: "${GARAGE_DEFAULT_BUCKET:?Set GARAGE_DEFAULT_BUCKET in .env}"
if [[ ! -s .ui-passphrase ]]; then
  echo "Create .ui-passphrase and put the dashboard passphrase on its first line." >&2
  exit 1
fi

mkdir -p .runtime data/metadata data/objects
chmod 700 .runtime data data/metadata data/objects

# Keep dashboard dependencies in this application's private virtual environment.
SERVER_PYTHON="$SERVER_DIR/.runtime/venv/bin/python"
if [[ ! -x "$SERVER_PYTHON" ]]; then
  python3 -m venv "$SERVER_DIR/.runtime/venv"
fi
if ! "$SERVER_PYTHON" -c 'import boto3' >/dev/null 2>&1; then
  "$SERVER_PYTHON" -m pip install --disable-pip-version-check -r "$SERVER_DIR/requirements.txt"
fi

GARAGE_VERSION="v2.4.1"
GARAGE_BINARY="$SERVER_DIR/.runtime/garage"
if [[ ! -x "$GARAGE_BINARY" ]]; then
  machine_arch="$(uname -m)"
  case "$machine_arch" in
    x86_64|amd64) garage_arch="x86_64-unknown-linux-musl" ;;
    aarch64|arm64) garage_arch="aarch64-unknown-linux-musl" ;;
    *) echo "Unsupported machine architecture for pinned Garage binary: $machine_arch" >&2; exit 1 ;;
  esac
  download_url="https://garagehq.deuxfleurs.fr/_releases/${GARAGE_VERSION}/${garage_arch}/garage"
  echo "Downloading Garage ${GARAGE_VERSION} from the official Garage release site..."
  curl --fail --location --retry 3 --proto '=https' --tlsv1.2 "$download_url" -o "$GARAGE_BINARY.tmp"
  chmod 700 "$GARAGE_BINARY.tmp"
  mv "$GARAGE_BINARY.tmp" "$GARAGE_BINARY"
fi

for secret_name in rpc admin metrics; do
  if [[ ! -s ".runtime/${secret_name}.secret" ]]; then
    umask 077
    openssl rand -hex 32 > ".runtime/${secret_name}.secret"
  fi
done
rpc_secret="$(<.runtime/rpc.secret)"
admin_token="$(<.runtime/admin.secret)"
metrics_token="$(<.runtime/metrics.secret)"

cat > .runtime/garage.toml <<EOF
metadata_dir = "$SERVER_DIR/data/metadata"
data_dir = "$SERVER_DIR/data/objects"
db_engine = "sqlite"
replication_factor = 1
rpc_bind_addr = "127.0.0.1:3901"
rpc_public_addr = "127.0.0.1:3901"
rpc_secret = "$rpc_secret"

[s3_api]
s3_region = "garage"
api_bind_addr = "${CS3_S3_BIND_ADDRESS:-127.0.0.1}:${CS3_S3_PORT:-3900}"
root_domain = ".s3.localhost"

[admin]
api_bind_addr = "127.0.0.1:3903"
admin_token = "$admin_token"
metrics_token = "$metrics_token"
EOF
chmod 600 .runtime/garage.toml

export GARAGE_CONFIG_FILE="$SERVER_DIR/.runtime/garage.toml"
export CS3_UI_PORT="${CS3_UI_PORT:-3904}"
export CS3_UI_PASSPHRASE="$(<.ui-passphrase)"
S3_PORT="${CS3_S3_PORT:-3900}"

"$GARAGE_BINARY" server --single-node --default-bucket &
GARAGE_PID=$!
WEBUI_PID=""
cleanup() {
  if [[ -n "$WEBUI_PID" ]]; then kill "$WEBUI_PID" 2>/dev/null || true; fi
  kill "$GARAGE_PID" 2>/dev/null || true
  wait "$GARAGE_PID" 2>/dev/null || true
  if [[ -n "$WEBUI_PID" ]]; then wait "$WEBUI_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM

ready=0
for _ in $(seq 1 60); do
  if ! kill -0 "$GARAGE_PID" 2>/dev/null; then
    echo "Garage exited before becoming ready." >&2
    exit 1
  fi
  if "$SERVER_PYTHON" -c 'import socket,sys;s=socket.socket();s.settimeout(.2);sys.exit(s.connect_ex(("127.0.0.1",int(sys.argv[1]))))' "$S3_PORT" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" != 1 ]]; then
  echo "Garage did not listen on 127.0.0.1:3900 within 60 seconds." >&2
  exit 1
fi

"$SERVER_PYTHON" "$SERVER_DIR/webui.py" &
WEBUI_PID=$!
echo "Garage S3 endpoint: http://${CS3_S3_BIND_ADDRESS:-127.0.0.1}:${S3_PORT}"
echo "Private bucket: ${GARAGE_DEFAULT_BUCKET}"
echo "Browser dashboard: http://127.0.0.1:${CS3_UI_PORT}"
echo "Press Ctrl+C to stop both services."
wait "$GARAGE_PID"
