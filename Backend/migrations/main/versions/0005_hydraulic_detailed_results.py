"""Store detailed hydraulic model output with saved snapshots."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

from app.models.business import HydraulicSimulationSnapshot

revision: str = "0005_hydraulic_detailed_results"
down_revision: Union[str, None] = "0004_water_sources"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if HydraulicSimulationSnapshot.__tablename__ not in inspect(bind).get_table_names():
        return
    if "detailed_results_json" not in {
        column["name"] for column in inspect(bind).get_columns(HydraulicSimulationSnapshot.__tablename__)
    }:
        op.add_column(
            HydraulicSimulationSnapshot.__tablename__,
            sa.Column("detailed_results_json", sa.JSON(), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    if (
        HydraulicSimulationSnapshot.__tablename__ in inspect(bind).get_table_names()
        and "detailed_results_json" in {
            column["name"] for column in inspect(bind).get_columns(HydraulicSimulationSnapshot.__tablename__)
        }
    ):
        op.drop_column(HydraulicSimulationSnapshot.__tablename__, "detailed_results_json")
