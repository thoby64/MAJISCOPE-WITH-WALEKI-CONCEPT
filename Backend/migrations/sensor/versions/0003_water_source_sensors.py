"""Add water-source sensor references, devices, and readings."""

from typing import Sequence, Union

from alembic import op

from app.models.sensor_platform import (
    SensorBase,
    WaterSourceRef,
    WaterSourceSensorDevice,
    WaterSourceSensorPendingReading,
    WaterSourceWaterLevelReading,
    WaterSourceWaterQualityReading,
)

revision: str = "0003_water_source_sensors"
down_revision: Union[str, None] = "0002_storage_facilities"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_TABLES = [
    WaterSourceRef.__table__,
    WaterSourceSensorDevice.__table__,
    WaterSourceWaterLevelReading.__table__,
    WaterSourceWaterQualityReading.__table__,
    WaterSourceSensorPendingReading.__table__,
]


def upgrade() -> None:
    SensorBase.metadata.create_all(bind=op.get_bind(), tables=_TABLES)


def downgrade() -> None:
    for table in reversed(_TABLES):
        table.drop(bind=op.get_bind(), checkfirst=True)
