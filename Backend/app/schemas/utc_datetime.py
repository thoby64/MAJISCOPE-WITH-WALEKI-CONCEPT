"""
Shared schema type for timezone-explicit datetime serialization.

The application stores *naive UTC* datetimes. Serialising them without a
timezone designator makes clients interpret them as local time. Every datetime
field exposed through a Pydantic schema should use ``UTCDateTime`` so API
responses always carry an explicit UTC (``Z``) suffix.
"""

from datetime import datetime, timezone
from typing import Annotated

from pydantic import PlainSerializer


def utc_datetime_isoformat(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat().replace("+00:00", "Z")


UTCDateTime = Annotated[
    datetime,
    PlainSerializer(utc_datetime_isoformat, return_type=str, when_used="json"),
]
