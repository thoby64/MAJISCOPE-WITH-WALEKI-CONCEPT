"""
Sensor Platform Database Configuration

Separate SQLAlchemy engine and session for the sensor platform database
(telemetry readings + sensor registry + mirrored tank references).

The sensor store is treated as a remote host: no cross-engine joins, no
cross-engine transactions. Business data stays in the main database; only
the tables owned by the sensor platform live here.
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

from app.config import settings


def _normalize_database_url(database_url: str) -> str:
    """
    Normalize provider URLs for SQLAlchemy (same rules as the main engine).
    """
    if database_url.startswith("postgres://"):
        return database_url.replace("postgres://", "postgresql+psycopg://", 1)

    if database_url.startswith("postgresql://") and "+psycopg" not in database_url and "+psycopg2" not in database_url:
        return database_url.replace("postgresql://", "postgresql+psycopg://", 1)

    return database_url


normalized_sensor_database_url = _normalize_database_url(settings.sensor_database_url)
sensor_connect_args = {"check_same_thread": False} if normalized_sensor_database_url.startswith("sqlite") else {}

sensor_engine = create_engine(
    normalized_sensor_database_url,
    echo=False,
    pool_pre_ping=True,
    pool_recycle=300,
    connect_args=sensor_connect_args,
)

# ============================================================
# Sensor Database Session Factory
# ============================================================

SensorSessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=sensor_engine,
)


# ============================================================
# Dependency for FastAPI
# ============================================================

def get_sensor_db() -> Session:
    """
    Get a sensor-platform database session for use in FastAPI routes.

    Usage in routes:
        @sensors_router.post("/ingest")
        def ingest(db: Session = Depends(get_sensor_db)):
            ...
    """
    db = SensorSessionLocal()
    try:
        yield db
    finally:
        db.close()
