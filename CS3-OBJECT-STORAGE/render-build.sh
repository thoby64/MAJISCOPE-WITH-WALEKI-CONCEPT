#!/usr/bin/env bash
set -euo pipefail

SERVER_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
GARAGE_VERSION="v2.4.1"
RUNTIME_DIR="$SERVER_DIR/.runtime"
GARAGE_BINARY="$RUNTIME_DIR/garage"
mkdir -p "$RUNTIME_DIR"

if [[ ! -x "$GARAGE_BINARY" ]]; then
  case "$(uname -m)" in
    x86_64|amd64) garage_arch="x86_64-unknown-linux-musl" ;;
    aarch64|arm64) garage_arch="aarch64-unknown-linux-musl" ;;
    *) echo "Unsupported machine architecture for pinned Garage binary: $(uname -m)" >&2; exit 1 ;;
  esac
  download_url="https://garagehq.deuxfleurs.fr/_releases/${GARAGE_VERSION}/${garage_arch}/garage"
  curl --fail --location --retry 3 --proto '=https' --tlsv1.2 "$download_url" -o "$GARAGE_BINARY.tmp"
  chmod 700 "$GARAGE_BINARY.tmp"
  mv "$GARAGE_BINARY.tmp" "$GARAGE_BINARY"
fi

"$GARAGE_BINARY" --version
