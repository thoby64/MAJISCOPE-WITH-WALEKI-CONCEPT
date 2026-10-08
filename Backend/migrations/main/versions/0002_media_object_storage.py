"""Add object storage metadata and durable media deletion queue."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002_media_object_storage"
down_revision: Union[str, None] = "0001_main_baseline"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "image_upload" not in inspector.get_table_names():
        raise RuntimeError("Cannot apply media object storage migration: image_upload table is missing")

    columns = {column["name"]: column for column in inspector.get_columns("image_upload")}
    unique_names = {
        item["name"]
        for item in inspector.get_unique_constraints("image_upload")
        if item.get("name")
    }
    index_names = {
        item["name"]
        for item in inspector.get_indexes("image_upload")
        if item.get("name")
    }
    needs_payload_nullable = not columns["file_data"].get("nullable", True)
    missing_columns = {
        "storage_backend": sa.Column("storage_backend", sa.String(length=16), nullable=True),
        "storage_key": sa.Column("storage_key", sa.String(length=512), nullable=True),
        "sha256": sa.Column("sha256", sa.String(length=64), nullable=True),
    }
    missing_columns = {name: column for name, column in missing_columns.items() if name not in columns}
    needs_unique = "uq_image_upload_storage_key" not in unique_names | index_names

    if needs_payload_nullable or missing_columns or needs_unique:
        with op.batch_alter_table("image_upload") as batch:
            if needs_payload_nullable:
                batch.alter_column(
                    "file_data",
                    existing_type=sa.LargeBinary(),
                    existing_nullable=False,
                    nullable=True,
                )
            for column in missing_columns.values():
                batch.add_column(column)
            if needs_unique:
                batch.create_unique_constraint("uq_image_upload_storage_key", ["storage_key"])

    if "media_storage_deletion" not in inspector.get_table_names():
        op.create_table(
            "media_storage_deletion",
            sa.Column("storage_key", sa.String(length=512), primary_key=True),
            sa.Column("storage_backend", sa.String(length=16), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("last_error", sa.Text(), nullable=True),
        )


def downgrade() -> None:
    # Refuse to discard object references or relaxations if external objects exist.
    bind = op.get_bind()
    if bind.execute(sa.text("SELECT COUNT(*) FROM image_upload WHERE storage_key IS NOT NULL")).scalar_one():
        raise RuntimeError("Cannot downgrade while object-backed media exists")
    inspector = sa.inspect(bind)
    if "media_storage_deletion" in inspector.get_table_names():
        op.drop_table("media_storage_deletion")
    if "image_upload" in inspector.get_table_names():
        columns = {column["name"] for column in inspector.get_columns("image_upload")}
        unique_names = {
            item["name"]
            for item in inspector.get_unique_constraints("image_upload")
            if item.get("name")
        }
        if any(name in columns for name in ("sha256", "storage_key", "storage_backend")) or "uq_image_upload_storage_key" in unique_names:
            with op.batch_alter_table("image_upload") as batch:
                if "uq_image_upload_storage_key" in unique_names:
                    batch.drop_constraint("uq_image_upload_storage_key", type_="unique")
                for name in ("sha256", "storage_key", "storage_backend"):
                    if name in columns:
                        batch.drop_column(name)
                file_data = next((column for column in inspector.get_columns("image_upload") if column["name"] == "file_data"), None)
                if file_data and file_data.get("nullable", True):
                    batch.alter_column("file_data", existing_type=sa.LargeBinary(), nullable=False)
