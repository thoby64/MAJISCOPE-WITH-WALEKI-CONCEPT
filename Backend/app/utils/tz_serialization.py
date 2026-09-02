"""
Timezone-explicit API serialization.

The whole application stores *naive UTC* datetimes (see ``datetime.utcnow``
defaults on the models and ``parse_timestamp`` in the sensor services). Naive
ISO strings without a timezone designator are ambiguous to clients: JavaScript
``new Date("2026-08-25T09:16:00")`` treats them as *local* time, which made
readings appear hours off in the Tanzania (UTC+3) UI.

To keep the API self-describing, every datetime leaving the API is serialised
as explicit UTC with a ``Z`` suffix. Naive values are assumed to be UTC (the
storage convention); aware values are kept as-is.
"""

from datetime import datetime

from fastapi.encoders import ENCODERS_BY_TYPE

from app.schemas.utc_datetime import utc_datetime_isoformat


def install_utc_datetime_serialization() -> None:
    """
    Replace FastAPI's default naive ``datetime`` encoder with one that always
    emits an explicit UTC designator. Must run before any request is served.

    Pydantic response models are covered by the ``UTCDateTime`` schema type;
    this hook covers raw dicts / ORM objects that bypass schemas.
    """
    ENCODERS_BY_TYPE[datetime] = utc_datetime_isoformat
