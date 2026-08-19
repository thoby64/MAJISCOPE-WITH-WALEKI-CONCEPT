"""
Business Models
SQLAlchemy ORM models for reports, logs, notifications, and push device tokens.
"""

from sqlalchemy import Column, String, Float, DateTime, Enum as SQLEnum, ForeignKey, Text, JSON, Integer, Boolean, UniqueConstraint, CheckConstraint
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid
import enum

from app.models.base import Base


class ReportStatusEnum(str, enum.Enum):
    """Report status enumeration"""
    NEW = "new"
    ASSIGNED = "assigned"
    IN_PROGRESS = "in_progress"
    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    REJECTED = "rejected"
    CLOSED = "closed"


class ReportPriorityEnum(str, enum.Enum):
    """Report priority enumeration"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class LeakageTypeEnum(str, enum.Enum):
    """Reported leakage type enumeration"""
    GROUND_LEAKAGE = "ground_leakage"
    PIPE_BURST = "pipe_burst"
    METER_LEAKAGE = "meter_leakage"
    VALVE_LEAKAGE = "valve_leakage"
    OVERFLOW = "overflow"
    UNKNOWN = "unknown"


class ReportTypeEnum(str, enum.Enum):
    """Top-level classification for a submitted utility report."""
    LEAKAGE = "leakage"
    NON_LEAKAGE = "non_leakage"


class NotificationTypeEnum(str, enum.Enum):
    """Notification type enumeration"""
    INFO = "info"
    WARNING = "warning"
    SUCCESS = "success"
    ERROR = "error"


class HydraulicLaunchStatusEnum(str, enum.Enum):
    """Hydraulic model launch session status."""
    READY = "ready"
    PREPARING = "preparing"
    PREPARED = "prepared"
    LAUNCHED = "launched"
    COMPLETED = "completed"
    CLEANED = "cleaned"
    FAILED = "failed"


# ============================================================
# Report Model
# ============================================================

class Report(Base):
    """Water Leakage Report - Main business entity"""
    
    __tablename__ = "report"
    __table_args__ = (
        CheckConstraint(
            "report_type IN ('leakage', 'non_leakage') AND "
            "((report_type = 'leakage' AND leakage_type IS NOT NULL) OR "
            "(report_type = 'non_leakage' AND leakage_type IS NULL))",
            name="ck_report_type_leakage_type",
        ),
    )
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tracking_id = Column(String(50), unique=True, nullable=False, index=True)
    description = Column(Text, nullable=False)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    address = Column(String(255), nullable=True)
    region_name = Column(String(100), nullable=True, index=True)
    district_name = Column(String(100), nullable=True, index=True)
    photos = Column(JSON, default=list)  # Array of image URLs
    priority = Column(SQLEnum(ReportPriorityEnum), default=ReportPriorityEnum.MEDIUM)
    report_type = Column(String(32), default=ReportTypeEnum.LEAKAGE.value, nullable=False, index=True)
    leakage_type = Column(String(50), default=LeakageTypeEnum.UNKNOWN.value, nullable=True, index=True)
    status = Column(SQLEnum(ReportStatusEnum), default=ReportStatusEnum.NEW, index=True)
    utility_id = Column(String(36), ForeignKey("utility.id"), nullable=True, index=True)
    dma_id = Column(String(36), ForeignKey("dma.id", ondelete="CASCADE"), nullable=True, index=True)
    team_id = Column(String(36), ForeignKey("team.id"), nullable=True)
    assigned_engineer_id = Column(String(36), ForeignKey("engineer.id"), nullable=True)
    reporter_name = Column(String(255), nullable=False)
    reporter_phone = Column(String(20), nullable=False)
    notes = Column(Text, nullable=True)
    engineer_submission_notes = Column(Text, nullable=True)
    team_leader_review_notes = Column(Text, nullable=True)
    dma_review_notes = Column(Text, nullable=True)
    public_history_key = Column(String(64), nullable=True, index=True)
    sla_deadline = Column(DateTime, nullable=False)
    resolved_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    # Relationships
    utility = relationship("Utility", back_populates="reports")
    dma = relationship("DMA", back_populates="reports")
    team = relationship("Team", back_populates="reports", foreign_keys=[team_id])
    assigned_engineer = relationship("Engineer", back_populates="reports", foreign_keys=[assigned_engineer_id])
    images = relationship("ImageUpload", back_populates="report", cascade="all, delete-orphan")


# ============================================================
# ActivityLog Model
# ============================================================

class ActivityLog(Base):
    """Activity Audit Log - Tracks all system activities"""
    
    __tablename__ = "activity_log"
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    action = Column(String(100), nullable=False)
    user_id = Column(String(36), ForeignKey("user.id", ondelete="SET NULL"), nullable=True, index=True)
    utility_mgr_id = Column(String(36), ForeignKey("utility_manager.id", ondelete="SET NULL"), nullable=True, index=True)
    dma_mgr_id = Column(String(36), ForeignKey("dma_manager.id", ondelete="SET NULL"), nullable=True, index=True)
    engineer_id = Column(String(36), ForeignKey("engineer.id", ondelete="SET NULL"), nullable=True, index=True)
    user_name = Column(String(255), nullable=False)
    user_role = Column(String(50), nullable=False)
    entity = Column(String(100), nullable=False)
    entity_id = Column(String(36), nullable=False)
    details = Column(Text, nullable=True)
    event_type = Column(String(100), nullable=True, index=True)
    status = Column(String(32), nullable=True, index=True)
    target_name = Column(String(255), nullable=True)
    ip_address = Column(String(64), nullable=True)
    user_agent = Column(Text, nullable=True)
    request_method = Column(String(16), nullable=True)
    request_path = Column(String(500), nullable=True)
    before_data = Column(JSON, nullable=True)
    after_data = Column(JSON, nullable=True)
    metadata_json = Column(JSON, nullable=True)
    error_message = Column(Text, nullable=True)
    utility_id = Column(String(36), ForeignKey("utility.id", ondelete="SET NULL"), nullable=True, index=True)
    dma_id = Column(String(36), ForeignKey("dma.id", ondelete="SET NULL"), nullable=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    
    # Relationships
    user = relationship("User", back_populates="activity_logs", foreign_keys=[user_id])
    utility_mgr = relationship("UtilityManager", back_populates="activity_logs", foreign_keys=[utility_mgr_id])
    dma_mgr = relationship("DMAManager", foreign_keys=[dma_mgr_id])
    engineer = relationship("Engineer", back_populates="activity_logs", foreign_keys=[engineer_id])
    utility = relationship("Utility", back_populates="activity_logs", foreign_keys=[utility_id])
    dma = relationship("DMA", back_populates="activity_logs", foreign_keys=[dma_id])


# ============================================================
# Hydraulic Model Integration Models
# ============================================================

class HydraulicModelLaunchSession(Base):
    """Temporary launch context for opening the hydraulic model with scoped DMA data."""

    __tablename__ = "hydraulic_model_launch_session"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("user.id", ondelete="SET NULL"), nullable=True, index=True)
    utility_mgr_id = Column(String(36), ForeignKey("utility_manager.id", ondelete="SET NULL"), nullable=True, index=True)
    dma_mgr_id = Column(String(36), ForeignKey("dma_manager.id", ondelete="SET NULL"), nullable=True, index=True)
    engineer_id = Column(String(36), ForeignKey("engineer.id", ondelete="SET NULL"), nullable=True, index=True)
    user_name = Column(String(255), nullable=False)
    user_role = Column(String(50), nullable=False, index=True)
    utility_id = Column(String(36), ForeignKey("utility.id", ondelete="CASCADE"), nullable=False, index=True)
    dma_id = Column(String(36), ForeignKey("dma.id", ondelete="CASCADE"), nullable=False, index=True)
    hydraulic_filename = Column(String(255), nullable=True)
    hydraulic_file_ref = Column(String(500), nullable=True)
    launch_token_hash = Column(String(128), nullable=True, unique=True, index=True)
    status = Column(String(32), default=HydraulicLaunchStatusEnum.PREPARING.value, nullable=False, index=True)
    readiness_json = Column(JSON, nullable=True)
    missing_required_json = Column(JSON, nullable=True)
    optional_status_json = Column(JSON, nullable=True)
    error_message = Column(Text, nullable=True)
    expires_at = Column(DateTime, nullable=False, index=True)
    launched_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    cleaned_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class HydraulicSimulationSnapshot(Base):
    """Saved output from a completed hydraulic model simulation run."""

    __tablename__ = "hydraulic_simulation_snapshot"

    __table_args__ = (
        UniqueConstraint("launch_session_id", "hydraulic_scenario_id", name="uq_hydraulic_snapshot_run"),
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    launch_session_id = Column(String(36), ForeignKey("hydraulic_model_launch_session.id", ondelete="SET NULL"), nullable=True, index=True)
    report_reference = Column(String(40), nullable=True, unique=True, index=True)
    utility_id = Column(String(36), ForeignKey("utility.id", ondelete="SET NULL"), nullable=True, index=True)
    dma_id = Column(String(36), ForeignKey("dma.id", ondelete="SET NULL"), nullable=True, index=True)
    utility_name = Column(String(255), nullable=True)
    dma_name = Column(String(255), nullable=True)
    hydraulic_scenario_id = Column(String(100), nullable=True, index=True)
    scenario_name = Column(String(255), nullable=True)
    scenario_status = Column(String(32), nullable=True, index=True)
    input_parameters_json = Column(JSON, nullable=True)
    summary_json = Column(JSON, nullable=True)
    nrw_json = Column(JSON, nullable=True)
    leakage_json = Column(JSON, nullable=True)
    alerts_json = Column(JSON, nullable=True)
    nodes_geojson = Column(JSON, nullable=True)
    pipes_geojson = Column(JSON, nullable=True)
    hotspots_geojson = Column(JSON, nullable=True)
    created_by_user_id = Column(String(36), nullable=True, index=True)
    created_by_role = Column(String(50), nullable=True)
    created_by_name = Column(String(255), nullable=True)
    created_by_email = Column(String(255), nullable=True)
    completed_at = Column(DateTime, nullable=True, index=True)
    execution_duration_seconds = Column(Float, nullable=True)
    snapshot_version = Column(Integer, default=1, nullable=False)
    result_quality = Column(String(32), nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)


# ============================================================
# Notification Model
# ============================================================

class Notification(Base):
    """Notification - User notifications"""
    
    __tablename__ = "notification"
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=False)
    type = Column(SQLEnum(NotificationTypeEnum), default=NotificationTypeEnum.INFO)
    read = Column(Boolean, default=False, index=True)
    link = Column(String(255), nullable=True)
    data = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    # Polymorphic ownership - one notification belongs to one user type
    user_id = Column(String(36), ForeignKey("user.id", ondelete="CASCADE"), nullable=True, index=True)
    utility_mgr_id = Column(String(36), ForeignKey("utility_manager.id", ondelete="CASCADE"), nullable=True, index=True)
    dma_mgr_id = Column(String(36), ForeignKey("dma_manager.id", ondelete="CASCADE"), nullable=True, index=True)
    engineer_id = Column(String(36), ForeignKey("engineer.id", ondelete="CASCADE"), nullable=True, index=True)
    
    # Relationships
    user = relationship("User", back_populates="notifications")
    utility_mgr = relationship("UtilityManager", back_populates="notifications")
    dma_mgr = relationship("DMAManager", back_populates="notifications")
    engineer = relationship("Engineer", back_populates="notifications")


class PushDeviceToken(Base):
    """Stores Expo push tokens for authenticated mobile devices."""

    __tablename__ = "push_device_token"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    expo_push_token = Column(String(255), nullable=False, unique=True, index=True)
    platform = Column(String(32), nullable=True)
    device_name = Column(String(255), nullable=True)
    device_id = Column(String(255), nullable=True)
    app_role = Column(String(50), nullable=True)
    active = Column(Boolean, default=True, index=True)
    last_registered_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    user_id = Column(String(36), ForeignKey("user.id", ondelete="CASCADE"), nullable=True, index=True)
    utility_mgr_id = Column(String(36), ForeignKey("utility_manager.id", ondelete="CASCADE"), nullable=True, index=True)
    dma_mgr_id = Column(String(36), ForeignKey("dma_manager.id", ondelete="CASCADE"), nullable=True, index=True)
    engineer_id = Column(String(36), ForeignKey("engineer.id", ondelete="CASCADE"), nullable=True, index=True)

    __table_args__ = (
        UniqueConstraint("user_id", "device_id", name="uq_push_device_token_user_device"),
        UniqueConstraint("utility_mgr_id", "device_id", name="uq_push_device_token_utility_device"),
        UniqueConstraint("dma_mgr_id", "device_id", name="uq_push_device_token_dma_device"),
        UniqueConstraint("engineer_id", "device_id", name="uq_push_device_token_engineer_device"),
    )
