#!/usr/bin/env python3
"""
Migrate sensor data from the main MajiScope database into the sensor platform DB.

Idempotent: safe to re-run after interruption (upserts on primary keys).
Preserves all IDs and timestamps (including UTC-normalised rows from the
timezone fix).

Usage (from the Backend directory):
    venv/bin/python scripts/migrate_sensor_data.py [--dry-run]

Requires DATABASE_URL and SENSOR_DATABASE_URL (from .env / environment).
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.models.sensor_platform import (
    SensorBase,
    SensorCategoryEnum,
    SensorDevice as PlatformSensorDevice,
    SensorPendingReading as PlatformPendingReading,
    TankRef,
    TankStatusEnum,
    WaterLevelReading,
)


def _to_naive_utc(value):
    if value is None:
        return None
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Report counts without writing")
    args = parser.parse_args()

    main_engine = create_engine(settings.database_url, pool_pre_ping=True)
    sensor_engine = create_engine(settings.sensor_database_url, pool_pre_ping=True)

    MainSession = sessionmaker(bind=main_engine)
    SensorSession = sessionmaker(bind=sensor_engine)

    # Ensure platform tables exist
    SensorBase.metadata.create_all(bind=sensor_engine)

    with MainSession() as mdb, SensorSession() as sdb:
        # ── 1. Tank reference mirror ────────────────────────────────────────
        tanks = mdb.execute(text(
            "SELECT id, utility_id, dma_id, source_key, name, latitude, longitude, "
            "status, created_at, updated_at, deactivated_at FROM tank"
        )).fetchall()
        print(f"[1/4] tank -> tank_ref : {len(tanks)} row(s)")

        for t in tanks:
            (tid, utility_id, dma_id, source_key, name, lat, lon, st, created, updated, deactivated) = t
            status_value = st if isinstance(st, str) else getattr(st, "value", "active")
            status_value = str(status_value).lower()  # main DB stores ACTIVE/DEACTIVATED
            existing = sdb.get(TankRef, tid)
            if existing is None:
                sdb.add(TankRef(
                    id=tid, utility_id=utility_id, dma_id=dma_id, source_key=source_key,
                    name=name, latitude=lat, longitude=lon,
                    status=TankStatusEnum(status_value),
                    created_at=_to_naive_utc(created) or datetime.utcnow(),
                    updated_at=_to_naive_utc(updated) or datetime.utcnow(),
                    deactivated_at=_to_naive_utc(deactivated),
                ))
        if not args.dry_run:
            sdb.commit()

        # ── 2. Sensor registry ──────────────────────────────────────────────
        devices = mdb.execute(text(
            "SELECT id, device_id, tank_id, h1_m, depth_m, warning_height_m, "
            "critical_height_m, activated, created_at, updated_at FROM sensor_device"
        )).fetchall()
        print(f"[2/4] sensor_device    : {len(devices)} row(s) (all -> category=water_level)")

        for d in devices:
            (sid, device_id, tank_id, h1_m, depth_m, warn, crit, activated, created, updated) = d
            config = {
                "h1_m": h1_m,
                "depth_m": depth_m,
                "warning_height_m": warn if warn is not None else 10.0,
                "critical_height_m": crit if crit is not None else 0.0,
            }
            existing = sdb.get(PlatformSensorDevice, sid)
            if existing is None:
                sdb.add(PlatformSensorDevice(
                    id=sid, device_id=device_id,
                    category=SensorCategoryEnum.WATER_LEVEL,
                    tank_id=tank_id, activated=bool(activated),
                    config=config,
                    created_at=_to_naive_utc(created) or datetime.utcnow(),
                    updated_at=_to_naive_utc(updated) or datetime.utcnow(),
                ))
            else:
                existing.config = config
                existing.activated = bool(activated)
                existing.updated_at = _to_naive_utc(updated) or datetime.utcnow()
        if not args.dry_run:
            sdb.commit()

        # ── 3. Water-level readings ──────────────────────────────────────────
        readings = mdb.execute(text(
            "SELECT id, sensor_id, tank_id, utility_id, dma_id, h1_m, depth_m, "
            "water_height_m, status, raw_data, occurred_at, created_at "
            "FROM sensor_reading"
        )).fetchall()
        print(f"[3/4] sensor_reading   : {len(readings)} row(s) -> water_level_reading")

        inserted = 0
        for r in readings:
            (rid, sensor_id, tank_id, utility_id, dma_id, h1_m, depth_m, whm, st,
             raw, occurred, created) = r
            if sdb.get(WaterLevelReading, rid) is not None:
                continue
            status_value = st if isinstance(st, str) else getattr(st, "value", "active")
            status_value = str(status_value).lower()  # main DB stores ACTIVE/DEACTIVATED
            from app.models.sensor_platform.registry import SensorStatusEnum as PStatus

            sdb.add(WaterLevelReading(
                id=rid, sensor_id=sensor_id, tank_id=tank_id, utility_id=utility_id,
                dma_id=dma_id, h1_m=h1_m or 0.0, depth_m=depth_m or 0.0,
                water_height_m=whm or 0.0, status=PStatus(status_value),
                raw_data=raw,
                occurred_at=_to_naive_utc(occurred) or datetime.utcnow(),
                created_at=_to_naive_utc(created) or datetime.utcnow(),
            ))
            inserted += 1
            if inserted % 1000 == 0 and not args.dry_run:
                sdb.commit()
        if not args.dry_run:
            sdb.commit()

        # ── 4. Pending readings (generic buffer, payload reconstructed) ─────
        pending = mdb.execute(text(
            "SELECT id, device_id, depth_m, raw_data, occurred_at, dedup_key, created_at "
            "FROM sensor_pending_reading"
        )).fetchall()
        print(f"[4/4] sensor_pending   : {len(pending)} row(s) -> generic JSONB buffer")

        import json as _json

        for p in pending:
            (pid, device_id, depth_m, raw, occurred, dedup, created) = p
            if sdb.get(PlatformPendingReading, pid) is not None:
                continue
            payload = {"device_id": device_id, "depth_m": depth_m, "raw_data": raw}
            sdb.add(PlatformPendingReading(
                id=pid, device_id=device_id,
                payload=_json.dumps(payload, default=str),
                occurred_at=_to_naive_utc(occurred) or datetime.utcnow(),
                dedup_key=dedup,
                created_at=_to_naive_utc(created) or datetime.utcnow(),
            ))
        if not args.dry_run:
            sdb.commit()

        # ── 5. Refresh denormalized tank counts ─────────────────────────────
        if not args.dry_run:
            devices_all = sdb.query(PlatformSensorDevice).all()
            counts: dict[str, list[int]] = {}
            for dev in devices_all:
                c = counts.setdefault(dev.tank_id, [0, 0])
                c[0] += 1
                if dev.activated:
                    c[1] += 1
            for tank_id, (total_c, active_c) in counts.items():
                ref = sdb.get(TankRef, tank_id)
                if ref is not None:
                    ref.sensor_count = total_c
                    ref.active_sensor_count = active_c
            sdb.commit()
            print(f"[5]   tank counts refreshed for {len(counts)} tank(s)")

        print()
        if args.dry_run:
            print("DRY RUN — nothing was written. Re-run without --dry-run to apply.")
        else:
            print("Migration complete. Old tables remain untouched in the main DB (soak period).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
