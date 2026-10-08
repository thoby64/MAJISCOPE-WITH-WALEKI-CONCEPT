#!/usr/bin/env bash
set -euo pipefail

BACKEND_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$BACKEND_DIR"

has_revision_table() {
  local table_name="$1"
  python - "$table_name" <<'PY'
import sys
from sqlalchemy import inspect
from app.database.session import engine
raise SystemExit(0 if sys.argv[1] in inspect(engine).get_table_names() else 1)
PY
}

# Existing production schemas may have been upgraded before Alembic tracking was
# enabled. The stamp command verifies the entire schema before recording the
# current revision. It refuses to stamp any schema that does not match models.
if ! has_revision_table alembic_version_main; then
  python scripts/stamp_baseline.py main
fi
if ! has_revision_table alembic_version_sensor; then
  python scripts/stamp_baseline.py sensor
fi

# Apply all later revisions once in Render's pre-deploy process, not once per
# application replica. In particular, this applies 0002_media_object_storage.
make migrate
