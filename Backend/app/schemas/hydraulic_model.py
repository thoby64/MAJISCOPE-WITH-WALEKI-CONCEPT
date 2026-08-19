"""
Schemas for the hydraulic model launch and snapshot integration.
"""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class HydraulicModelChoice(BaseModel):
    id: str
    name: str


class HydraulicModelRequirementStatus(BaseModel):
    key: str
    label: str
    present: bool
    required: bool = True
    message: Optional[str] = None


class HydraulicModelReadinessRequest(BaseModel):
    utility_id: Optional[str] = None
    dma_id: Optional[str] = None


class HydraulicModelReadinessResponse(BaseModel):
    ready: bool
    can_prepare: bool
    role: str
    selected_utility_id: Optional[str] = None
    selected_dma_id: Optional[str] = None
    utilities: list[HydraulicModelChoice] = Field(default_factory=list)
    dmas: list[HydraulicModelChoice] = Field(default_factory=list)
    required: list[HydraulicModelRequirementStatus] = Field(default_factory=list)
    optional: list[HydraulicModelRequirementStatus] = Field(default_factory=list)
    message: str
    action_hint: Optional[str] = None


class HydraulicModelPrepareRequest(BaseModel):
    utility_id: Optional[str] = None
    dma_id: Optional[str] = None


class HydraulicModelPrepareResponse(BaseModel):
    session_id: str
    ready: bool
    status: str
    launch_url: Optional[str] = None
    expires_at: datetime
    message: str


class HydraulicSimulationSnapshotCreate(BaseModel):
    launch_session_id: Optional[str] = None
    utility_id: str
    dma_id: str
    hydraulic_scenario_id: Optional[str] = None
    scenario_name: Optional[str] = None
    scenario_status: Optional[str] = None
    input_parameters_json: Optional[dict[str, Any]] = None
    summary_json: Optional[dict[str, Any]] = None
    nrw_json: Optional[dict[str, Any]] = None
    leakage_json: Optional[dict[str, Any]] = None
    alerts_json: Optional[dict[str, Any]] = None
    nodes_geojson: Optional[dict[str, Any]] = None
    pipes_geojson: Optional[dict[str, Any]] = None
    hotspots_geojson: Optional[dict[str, Any]] = None
    completed_at: Optional[datetime] = None
    execution_duration_seconds: Optional[float] = Field(None, ge=0)
    snapshot_version: int = Field(1, ge=1)
    result_quality: Optional[str] = None
    error_message: Optional[str] = None


class HydraulicSimulationSnapshotResponse(BaseModel):
    id: str
    report_reference: Optional[str]
    launch_session_id: Optional[str]
    utility_id: Optional[str]
    dma_id: Optional[str]
    hydraulic_scenario_id: Optional[str]
    scenario_name: Optional[str]
    scenario_status: Optional[str]
    created_by_user_id: Optional[str]
    created_by_role: Optional[str]
    created_by_name: Optional[str]
    created_by_email: Optional[str]
    utility_name: Optional[str]
    dma_name: Optional[str]
    completed_at: Optional[datetime]
    execution_duration_seconds: Optional[float]
    snapshot_version: int
    result_quality: Optional[str]
    error_message: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class HydraulicSimulationSnapshotListItem(HydraulicSimulationSnapshotResponse):
    pressure_min_m: Optional[float] = None
    pressure_avg_m: Optional[float] = None
    nrw_pct: Optional[float] = None
    alert_count: int = 0


class HydraulicSimulationSnapshotListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    pages: int
    items: list[HydraulicSimulationSnapshotListItem] = Field(default_factory=list)


class HydraulicSimulationSnapshotDetail(HydraulicSimulationSnapshotResponse):
    input_parameters_json: Optional[dict[str, Any]] = None
    summary_json: Optional[dict[str, Any]] = None
    nrw_json: Optional[dict[str, Any]] = None
    leakage_json: Optional[dict[str, Any]] = None
    alerts_json: Optional[dict[str, Any]] = None
    nodes_geojson: Optional[dict[str, Any]] = None
    pipes_geojson: Optional[dict[str, Any]] = None
    hotspots_geojson: Optional[dict[str, Any]] = None


class HydraulicScenarioComparisonRequest(BaseModel):
    snapshot_ids: list[str] = Field(min_length=2, max_length=5)
    baseline_snapshot_id: str


class HydraulicScenarioComparisonItem(BaseModel):
    id: str
    report_reference: Optional[str] = None
    scenario_name: Optional[str] = None
    utility_id: Optional[str] = None
    utility_name: Optional[str] = None
    dma_id: Optional[str] = None
    dma_name: Optional[str] = None
    created_by_name: Optional[str] = None
    completed_at: Optional[datetime] = None
    snapshot_version: int = 1
    inputs: dict[str, Any] = Field(default_factory=dict)
    pressure: dict[str, Any] = Field(default_factory=dict)
    pressure_zones: list[dict[str, Any]] = Field(default_factory=list)
    pressure_time_series: list[dict[str, Any]] = Field(default_factory=list)
    water_balance: dict[str, Any] = Field(default_factory=dict)
    risk_distribution: dict[str, int] = Field(default_factory=dict)


class HydraulicScenarioComparisonResponse(BaseModel):
    baseline_snapshot_id: str
    utility_id: str
    utility_name: Optional[str] = None
    dma_id: str
    dma_name: Optional[str] = None
    scenarios: list[HydraulicScenarioComparisonItem] = Field(default_factory=list)
