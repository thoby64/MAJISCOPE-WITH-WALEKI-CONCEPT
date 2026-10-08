"""Verify and migrate legacy report media to configured S3-compatible storage."""

import argparse
import sys

sys.path.insert(0, ".")

from sqlalchemy import func, select

from app.database.session import SessionLocal
from app.models import ImageUpload, Report
from app.services.media_storage_migration import migrate_report_media


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Copy and verify objects; default is a read-only summary")
    parser.add_argument("--purge-binary", action="store_true", help="Clear database payloads after verified object readback")
    args = parser.parse_args()
    if args.purge_binary and not args.apply:
        parser.error("--purge-binary requires --apply")

    with SessionLocal() as db:
        payload_rows = db.execute(
            select(func.count(ImageUpload.id)).where(ImageUpload.file_data.is_not(None))
        ).scalar_one()
        object_rows = db.execute(
            select(func.count(ImageUpload.id)).where(ImageUpload.storage_key.is_not(None))
        ).scalar_one()
        report_rows = db.execute(
            select(func.count(Report.id)).where(Report.photos.is_not(None))
        ).scalar_one()
        inline_count = 0
        for photos, in db.execute(select(Report.photos).where(Report.photos.is_not(None))):
            if isinstance(photos, list):
                inline_count += sum(isinstance(item, str) and item.startswith("data:") for item in photos)

        print(
            f"Media inventory: payload rows={payload_rows}, object references={object_rows}, "
            f"reports with photo fields={report_rows}, inline data URIs={inline_count}"
        )
        if not args.apply:
            print("Dry run only. Use --apply --purge-binary to migrate, verify, and remove legacy database payloads.")
            return

        result = migrate_report_media(db, purge_binary=args.purge_binary)
        print("Migration complete:", ", ".join(f"{key}={value}" for key, value in result.items()))


if __name__ == "__main__":
    main()
