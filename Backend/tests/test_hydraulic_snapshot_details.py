from datetime import datetime
from types import SimpleNamespace

from app.api.hydraulic_model import _snapshot_comparison_item, _snapshot_list_item


def _snapshot():
    return SimpleNamespace(
        id="snapshot-1",
        report_reference="HYD-1",
        launch_session_id="launch-1",
        utility_id="utility-1",
        dma_id="dma-1",
        utility_name="DUWASA",
        dma_name="Nzuguni",
        hydraulic_scenario_id="scenario-1",
        scenario_name="Scenario",
        scenario_status="DONE",
        created_by_user_id="user-1",
        created_by_role="admin",
        created_by_name="Admin",
        created_by_email="admin@example.com",
        completed_at=datetime(2026, 10, 15),
        execution_duration_seconds=30.0,
        snapshot_version=4,
        result_quality="complete",
        error_message="Additional warning",
        created_at=datetime(2026, 10, 15),
        input_parameters_json={},
        summary_json={"pressure_min_m": 2.0, "pressure_avg_m": 20.0},
        nrw_json={"nrw_pct": 12.0},
        leakage_json={"warnings": ["Shared warning"], "pressure_zones": []},
        alerts_json={"warnings": ["Shared warning", "Model warning"]},
        detailed_results_json={
            "report_text": "Full hydraulic report",
            "time_series": [{"hour": 0.5, "water_age_avg_hrs": 2.0}],
        },
        nodes_geojson={},
        hotspots_geojson={},
    )


def test_snapshot_list_counts_all_unique_warning_sources():
    result = _snapshot_list_item(_snapshot(), db=None)

    assert result.alert_count == 3


def test_comparison_includes_detailed_time_series_and_report_availability():
    result = _snapshot_comparison_item(_snapshot(), db=None)

    assert result.report_available is True
    assert result.detailed_time_series == [{"hour": 0.5, "water_age_avg_hrs": 2.0}]
