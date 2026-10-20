"""Ensure infrastructure layers retain their storage-facility key field."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision: str = "0006_storage_facility_key_field"
down_revision: Union[str, None] = "0005_hydraulic_detailed_results"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    table_name = "utility_infrastructure_layer"
    if table_name not in inspect(bind).get_table_names():
        raise RuntimeError(
            "Cannot add storage-facility key field: utility_infrastructure_layer table is missing"
        )
    columns = {column["name"] for column in inspect(bind).get_columns(table_name)}
    if "storage_facility_key_field" not in columns:
        op.add_column(
            table_name,
            sa.Column("storage_facility_key_field", sa.String(length=100), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    table_name = "utility_infrastructure_layer"
    if (
        table_name in inspect(bind).get_table_names()
        and "storage_facility_key_field"
        in {column["name"] for column in inspect(bind).get_columns(table_name)}
    ):
        op.drop_column(table_name, "storage_facility_key_field")
