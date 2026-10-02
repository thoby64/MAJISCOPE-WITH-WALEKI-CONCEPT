"""Baseline for the current sensor database schema.

This revision intentionally performs no DDL. Fresh development databases are
created from the current SQLAlchemy metadata before they are stamped. Existing
databases must be schema-checked before this revision is stamped.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0001_sensor_baseline"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass