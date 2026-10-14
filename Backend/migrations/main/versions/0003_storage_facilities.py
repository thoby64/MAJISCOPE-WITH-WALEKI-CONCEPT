"""Rename the main-database tank domain to storage facilities."""

from typing import Sequence, Union

from alembic import op

from app.services.storage_facility_migrations import (
    downgrade_storage_facility_schema_on_connection,
    migrate_storage_facility_schema_on_connection,
)

revision: str = "0003_storage_facilities"
down_revision: Union[str, None] = "0002_media_object_storage"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    migrate_storage_facility_schema_on_connection(op.get_bind())


def downgrade() -> None:
    downgrade_storage_facility_schema_on_connection(op.get_bind())
