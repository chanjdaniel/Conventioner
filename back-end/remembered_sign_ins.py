"""Remember me on a vendor page: how long a remembered sign-in may last (ADR 0021).

A vendor who ticks "Remember me on this device" stays signed in to that market's page until the
market's last date has ended, and never longer than ``REMEMBER_AT_MOST`` from the sign-in.
"""
from datetime import date, datetime, time, timedelta, timezone
from typing import Iterable, Optional

#: The longest a remembered sign-in lasts, whatever the market's dates.
REMEMBER_AT_MOST = timedelta(days=120)

#: When the market's last date has ended in every time zone: noon UTC on the day after it.
_LAST_DATE_ENDS_AT = time(12, 0, tzinfo=timezone.utc)


def now() -> datetime:
    """The current time, in UTC; a function so a test can move the clock."""
    return datetime.now(timezone.utc)


def _last_date_end(market_dates: Iterable[str]) -> Optional[datetime]:
    days = []
    for value in market_dates:
        try:
            days.append(date.fromisoformat(str(value)[:10]))
        except ValueError:
            continue
    if not days:
        return None
    return datetime.combine(max(days) + timedelta(days=1), _LAST_DATE_ENDS_AT)


def remembered_until(market_dates: Iterable[str], at: datetime) -> Optional[datetime]:
    """When a sign-in remembered at ``at`` would end, or ``None`` when the market has no date left.

    The earlier of the end of the market's last date and ``REMEMBER_AT_MOST`` after ``at``.
    """
    last_date_end = _last_date_end(market_dates)
    if last_date_end is None or last_date_end <= at:
        return None
    return min(last_date_end, at + REMEMBER_AT_MOST)


def remembered_until_date(market_dates: Iterable[str], at: datetime) -> Optional[str]:
    """The date a vendor reads beside "Remember me", as ``YYYY-MM-DD``, or ``None``.

    The market's last date when that is what ends it, rather than the noon after it that does,
    else the date ``REMEMBER_AT_MOST`` on.
    """
    dates = list(market_dates)
    until = remembered_until(dates, at)
    if until is None:
        return None
    if until == _last_date_end(dates):
        return (until - timedelta(days=1)).date().isoformat()
    return until.date().isoformat()
