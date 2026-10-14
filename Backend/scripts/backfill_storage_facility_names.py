#!/usr/bin/env python
"""Backfill storage_facility names: convert numeric names to "STORAGE_FACILITY-<number>".

StorageFacilitys imported from GPKG features whose only identifier was a number (e.g.
ObjectID/Id columns with values like 322, 1357) previously ended up with
plain "STORAGE_FACILITY" names. This script renames them to "STORAGE_FACILITY-<number>" by using
their source_key (which preserves the original numeric value).

Idempotent: only renames storage_facilities whose name is the plain default "STORAGE_FACILITY" and
whose source_key is purely numeric.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database.session import SessionLocal
from app.models.sensors import StorageFacility
from app.services.storage_facility_sync import DEFAULT_STORAGE_FACILITY_NAME


def _is_numeric_only(text: str) -> bool:
    if not text:
        return False
    return text.strip().isdigit()


def main() -> None:
    db = SessionLocal()
    try:
        storage_facilities = db.query(StorageFacility).all()
        renamed = 0
        for storage_facility in storage_facilities:
            if storage_facility.name == DEFAULT_STORAGE_FACILITY_NAME and _is_numeric_only(storage_facility.source_key):
                storage_facility.name = f"{DEFAULT_STORAGE_FACILITY_NAME}-{storage_facility.source_key.strip()}"
                renamed += 1
        db.commit()
        print(f"Scanned {len(storage_facilities)} storage_facility(s); renamed {renamed} to 'STORAGE_FACILITY-<number>'.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
