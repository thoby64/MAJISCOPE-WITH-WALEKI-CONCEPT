"""Rename sensor-platform tank references to storage facilities."""

from typing import Sequence, Union

from alembic import op

from app.services.storage_facility_migrations import (
    downgrade_storage_facility_schema_on_connection,
    migrate_storage_facility_schema_on_connection,
)

revision: str = "0002_storage_facilities"
down_revision: Union[str, None] = "0001_sensor_baseline"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    migrate_storage_facility_schema_on_connection(op.get_bind(), sensor_platform=True)


def downgrade() -> None:
    downgrade_storage_facility_schema_on_connection(op.get_bind(), sensor_platform=True)
