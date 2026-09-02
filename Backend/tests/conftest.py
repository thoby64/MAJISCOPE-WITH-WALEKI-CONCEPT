"""
Pytest Configuration and Fixtures
Shared test fixtures and configuration
"""

import pytest
from datetime import datetime
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database.session import get_db
from app.database.sensor_session import get_sensor_db
from app.models.sensor_platform import SensorBase
from app.models.base import Base
from app.models import User
from app.security.auth import hash_password
from app.middleware import RateLimitMiddleware

# The in-memory RateLimitMiddleware shares one client-IP bucket across the
# whole suite (every TestClient request arrives as "testclient"). The
# production cap of 100 req/min would spuriously 429 tail-of-suite tests,
# so lift the cap for the test session.
for _mw in app.user_middleware:
    if _mw.cls is RateLimitMiddleware:
        _mw.options["requests_per_minute"] = 1_000_000


# Use in-memory SQLite for testing
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# ── Sensor platform test engine (separate in-memory DB) ─────────────────────
sensor_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
SensorTestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=sensor_engine)

# Modules whose internal SensorSessionLocal must point at the test engine
# while the suite runs (mirror hooks instantiate their own sessions).
# Patched for the ENTIRE test session so no test — regardless of which
# fixtures it requests — can ever write to the configured sensor database.
import app.database.sensor_session as _sensor_session_module
import app.services.sensor_platform_sync as _sensor_sync_module

_OriginalSensorSessionLocal = _sensor_session_module.SensorSessionLocal
_sensor_session_module.SensorSessionLocal = SensorTestingSessionLocal
_sensor_sync_module.SensorSessionLocal = SensorTestingSessionLocal
# Ensure sensor-platform tables exist for the whole session so mirror hooks
# from any test (even ones not requesting the sensor_db fixture) succeed
# against the in-memory engine instead of leaking to the configured DB.
SensorBase.metadata.create_all(bind=sensor_engine)


def override_get_db():
    """Override database dependency for tests"""
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()


def override_get_sensor_db():
    """Override sensor-platform database dependency for tests"""
    try:
        db = SensorTestingSessionLocal()
        yield db
    finally:
        db.close()


@pytest.fixture(scope="function")
def db():
    """Create test database and tables"""
    Base.metadata.create_all(bind=engine)
    yield TestingSessionLocal()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="function")
def sensor_db():
    """Sensor-platform test session (engine + schema managed per test).

    The global SensorSessionLocal patch is applied at conftest import time
    for the whole session (see module level); this fixture only manages
    per-test table lifecycle and yields a session.
    """
    SensorBase.metadata.create_all(bind=sensor_engine)
    yield SensorTestingSessionLocal()
    SensorBase.metadata.drop_all(bind=sensor_engine)


@pytest.fixture(scope="function")
def client(db: Session, sensor_db: Session):
    """Create test client with overridden databases"""
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_sensor_db] = override_get_sensor_db
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture(scope="function")
def test_user(db: Session) -> User:
    """Create a test user"""
    user = User(
        email="test@example.com",
        name="Test User",
        phone="+1234567890",
        password=hash_password("testpassword123"),
        setup_completed_at=datetime.utcnow(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture(scope="function")
def auth_headers(test_user: User):
    """Generate auth headers with valid token"""
    from app.security.auth import create_access_token
    
    token = create_access_token(test_user.id, test_user.email)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="function")
def admin_user(db: Session) -> User:
    """Create an admin test user"""
    user = User(
        email="admin@example.com",
        name="Admin User",
        phone="+9876543210",
        password=hash_password("adminpassword123"),
        setup_completed_at=datetime.utcnow(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture(scope="function")
def admin_auth_headers(admin_user: User):
    """Generate auth headers for admin user"""
    from app.security.auth import create_access_token
    
    token = create_access_token(admin_user.id, admin_user.email)
    return {"Authorization": f"Bearer {token}"}
