"""
Models Package
SQLAlchemy ORM models for database tables
"""

from app.models.base import Base
from app.models.user import (
    User,
    Utility,
    UtilityManager,
    UtilityInfrastructureLayer,
    UtilityServiceArea,
    UtilityServiceAreaCategoryEnum,
    DMA,
    DMAManager,
    Team,
    Engineer,
    EntityStatusEnum,
)
from app.models.business import (
    Report,
    ActivityLog,
    HydraulicLaunchStatusEnum,
    HydraulicModelLaunchSession,
    HydraulicSimulationSnapshot,
    Notification,
    PushDeviceToken,
    ReportStatusEnum,
    ReportPriorityEnum,
    ReportTypeEnum,
    LeakageTypeEnum,
    NotificationTypeEnum,
)
from app.models.uploads import (
    ImageUpload,
    ImageTypeEnum,
)
from app.models.sensors import (
    Tank,
    TankStatusEnum,
)

__all__ = [
    "Base",
    # User models
    "User",
    "Utility",
    "UtilityManager",
    "UtilityInfrastructureLayer",
    "UtilityServiceArea",
    "DMA",
    "DMAManager",
    "Team",
    "Engineer",
    # Business models
    "Report",
    "ActivityLog",
    "HydraulicLaunchStatusEnum",
    "HydraulicModelLaunchSession",
    "HydraulicSimulationSnapshot",
    "Notification",
    "PushDeviceToken",
    # Upload models
    "ImageUpload",
    # Sensor-era models (tank remains; sensors/readings live in the sensor platform DB)
    "Tank",
    # Enums
    "EntityStatusEnum",
    "UtilityServiceAreaCategoryEnum",
    "ReportStatusEnum",
    "ReportPriorityEnum",
    "ReportTypeEnum",
    "LeakageTypeEnum",
    "NotificationTypeEnum",
    "ImageTypeEnum",
    "TankStatusEnum",
]
