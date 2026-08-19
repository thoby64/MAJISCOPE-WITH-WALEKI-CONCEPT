from app.api.reports import _report_classification, _report_type_value
from app.models.business import ReportTypeEnum
from app.schemas.business import AnonymousReportCreate


def test_legacy_report_defaults_to_leakage_unknown() -> None:
    assert _report_classification(None, None) == ("leakage", "unknown")


def test_non_leakage_report_always_clears_leakage_type() -> None:
    assert _report_classification("non_leakage", "pipe_burst") == ("non_leakage", None)


def test_report_type_normalizer_accepts_display_alias() -> None:
    assert _report_type_value("non-leakage") == ReportTypeEnum.NON_LEAKAGE.value


def test_mobile_payload_accepts_canonical_non_leakage_type() -> None:
    payload = AnonymousReportCreate(
        description="Storage tank has no water",
        latitude=-6.1,
        longitude=35.7,
        report_type="non_leakage",
        leakage_type="overflow",
    )
    assert payload.report_type.value == "non_leakage"
    assert payload.leakage_type is None


def test_mobile_payload_keeps_high_priority_input() -> None:
    payload = AnonymousReportCreate(
        description="No water at the storage tank",
        latitude=-6.1,
        longitude=35.7,
        priority="High",
        report_type="non_leakage",
        leakage_type=None,
    )
    assert payload.priority == "High"
