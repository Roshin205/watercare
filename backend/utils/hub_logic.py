"""The working rules of the Operations pages: visit schedules, sample dates and delivery note numbers.

Nothing here touches the database, so each rule can be read and tested on its own.
A contract's schedule is a map of month to visit: {"2026-10": {"status": "due", "date": "2026-10-01", "engineer": ""}}.
"""
import re
from datetime import date, timedelta

FREQUENCY_MONTHS = {"Monthly": 1, "Bimonthly": 2, "Quarterly": 3, "Half-yearly": 6, "Yearly": 12}
VISIT_STATES = {"due", "done", "missed", "na"}


def month_of(value):
    return str(value)[:7]


def shift_month(month, count):
    year, number = int(month[:4]), int(month[5:7])
    total = year * 12 + number - 1 + count
    return f"{total // 12:04d}-{total % 12 + 1:02d}"


def add_months(value, count):
    """The same day `count` months later, pulled back to the month's last day when needed."""
    parsed = date.fromisoformat(value)
    month = shift_month(value, count)
    year, number = int(month[:4]), int(month[5:7])
    following = date(year + number // 12, number % 12 + 1, 1)
    return date(year, number, min(parsed.day, (following - timedelta(days=1)).day)).isoformat()


def fill_schedule(contract, today):
    """Mark this month onward as Due by frequency, inside the contract dates. Done, Missed and N/A months stay."""
    months = FREQUENCY_MONTHS.get(contract.get("frequency") or "")
    start, expiry = contract.get("start"), contract.get("expiry")
    schedule = dict(contract.get("schedule") or {})
    if not months or not start:  # On call, or nothing to count from
        return schedule
    this_month = month_of(today)
    last_month = month_of(expiry) if expiry else shift_month(this_month, 12)
    wanted = set()
    month = month_of(start)
    while month <= last_month:
        if month >= this_month:
            wanted.add(month)
        month = shift_month(month, months)
    for month, visit in list(schedule.items()):
        if month >= this_month and visit.get("status") == "due" and month not in wanted:
            del schedule[month]
    for month in wanted:
        if month not in schedule:
            schedule[month] = {"status": "due", "date": f"{month}-01", "engineer": contract.get("engineer") or ""}
    return schedule


def refresh_visit_dates(contract):
    """Last visit, next due and who visited follow the schedule whenever it has entries."""
    schedule = contract.get("schedule") or {}
    done = sorted((visit.get("date") or f"{month}-01", visit) for month, visit in schedule.items() if visit.get("status") == "done")
    due = sorted(visit.get("date") or f"{month}-01" for month, visit in schedule.items() if visit.get("status") == "due")
    if done:
        contract["last_visit"] = done[-1][0]
        if done[-1][1].get("engineer"):
            contract["visited_by"] = done[-1][1]["engineer"]
    if schedule:
        contract["next_due"] = due[0] if due else ""
    return contract


def set_visit(contract, month, today, status=None, visit_date=None, engineer=None, move_to=None, remove=False):
    """One month of a schedule changes; the contract's dates follow. Raises ValueError for an unusable request."""
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month or ""):
        raise ValueError("Choose a valid month.")
    schedule = dict(contract.get("schedule") or {})
    if remove or status == "":
        schedule.pop(month, None)
    else:
        visit = dict(schedule.get(month) or {"status": "due", "date": f"{month}-01", "engineer": ""})
        if status is not None:
            if status not in VISIT_STATES:
                raise ValueError("Visit status must be Due, Done, Missed or Not applicable.")
            visit["status"] = status
        if visit_date is not None:
            visit["date"] = visit_date or f"{month}-01"
        if engineer is not None:
            visit["engineer"] = engineer
        if move_to and move_to != month:
            if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", move_to):
                raise ValueError("Choose a valid month.")
            if move_to in schedule:
                raise ValueError("This site already has a visit in that month.")
            schedule.pop(month, None)
            if month_of(visit["date"]) != move_to:
                visit["date"] = f"{move_to}-01"
            month = move_to
        schedule[month] = visit
    contract["schedule"] = schedule
    return refresh_visit_dates(contract)


def completion_timing(actual, scheduled):
    """How the actual completion date compares with the planned date."""
    if actual == scheduled:
        return "Completed on the Scheduled Date"
    return "Completed Before the Scheduled Date" if actual < scheduled else "Completed After the Scheduled Date"


def duration_days(name, durations):
    for option in durations or []:
        if option.get("name") == name:
            return int(option.get("days") or 0)
    return 0


def sample_dates(collection_date, duration, durations):
    """Next due and expiry for a sample: collection date plus the duration's days. Once has no next date."""
    days = duration_days(duration, durations)
    if not collection_date or not days:
        return "", ""
    following = (date.fromisoformat(collection_date) + timedelta(days=days)).isoformat()
    return following, following


def dn_serial(number):
    match = re.fullmatch(r"DN-(\d{2})-(\d+)", number or "")
    return (match.group(1), int(match.group(2))) if match else (None, 0)


def next_dn(numbers, start, today):
    """DN-YY-NNN, continuing from the last number used this year (and never below the starting number)."""
    year = str(today.year)[2:]
    used = [serial for prefix, serial in map(dn_serial, numbers) if prefix == year]
    return f"DN-{year}-{max(used + [int(start or 1) - 1]) + 1:03d}"
