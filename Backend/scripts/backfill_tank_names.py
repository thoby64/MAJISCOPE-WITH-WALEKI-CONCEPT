#!/usr/bin/env python
"""Backfill tank names: convert numeric names to "TANK-<number>".

Tanks imported from GPKG features whose only identifier was a number (e.g.
ObjectID/Id columns with values like 322, 1357) previously ended up with
plain "TANK" names. This script renames them to "TANK-<number>" by using
their source_key (which preserves the original numeric value).

Idempotent: only renames tanks whose name is the plain default "TANK" and
whose source_key is purely numeric.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database.session import SessionLocal
from app.models.sensors import Tank
from app.services.tank_sync import DEFAULT_TANK_NAME


def _is_numeric_only(text: str) -> bool:
    if not text:
        return False
    return text.strip().isdigit()


def main() -> None:
    db = SessionLocal()
    try:
        tanks = db.query(Tank).all()
        renamed = 0
        for tank in tanks:
            if tank.name == DEFAULT_TANK_NAME and _is_numeric_only(tank.source_key):
                tank.name = f"{DEFAULT_TANK_NAME}-{tank.source_key.strip()}"
                renamed += 1
        db.commit()
        print(f"Scanned {len(tanks)} tank(s); renamed {renamed} to 'TANK-<number>'.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
