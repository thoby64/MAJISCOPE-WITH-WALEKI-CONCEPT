"""Add water-source entities and their mirror outbox."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from app.models import Base, UtilityInfrastructureLayer, WaterSource, WaterSourceSensorMirrorOutbox

revision: str = "0004_water_sources"
down_revision: Union[str, None] = "0003_storage_facilities"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        UtilityInfrastructureLayer.__tablename__,
        sa.Column("water_source_key_field", sa.String(length=100), nullable=True),
    )
    Base.metadata.create_all(
        bind=op.get_bind(),
        tables=[WaterSource.__table__, WaterSourceSensorMirrorOutbox.__table__],
    )


def downgrade() -> None:
    op.drop_table(WaterSourceSensorMirrorOutbox.__tablename__)
    op.drop_table(WaterSource.__tablename__)
    op.drop_column(UtilityInfrastructureLayer.__tablename__, "water_source_key_field")
