"""Expected answers from an independent implementation: Python's datetime and zoneinfo (the machine's IANA data).

Run by src/crosscheck.test.ts when DATE_CALC_CROSSCHECK=1 (never by the normal tests): python3 -I zoneinfo.py <zones.json>
<seed> <count> prints one JSON document to stdout. Nothing is installed; only the standard library is used.

Kinds of cases (docs/tools/specs/date-calc.md §10 «Сверка с Python»):
  wall      an instant in a zone -> the offset, the local ISO 8601 and whether dst() is not zero;
  resolve   a wall time in a zone -> the instant with fold=0 (PEP 495: the offset before a gap, the first of an overlap —
            Temporal's `compatible`) and whether it was a gap, an overlap or exact;
  add_days  an instant plus n calendar days (wall-clock arithmetic, fold=0) plus exact milliseconds;
  add_months an instant plus n months (the day constrained to the month's end — the stated rule, written here again)
            plus days, fold=0, plus exact milliseconds;
and `offsets`: every zone's offset at 00:00 UTC on the 1st of every month from 1900 to 2100, to tell where the two zone
databases differ.

Instants: half uniformly in 1900-2040, a third within hours of a clock change (found by scanning the year day by day),
the rest before 1900 or after 2040.
"""

import json
import random
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, available_timezones

EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
MS = timedelta(milliseconds=1)


def ms_of(dt):
    return (dt - EPOCH) // MS


def at(ms):
    return EPOCH + timedelta(milliseconds=ms)


def offset_text(seconds):
    sign = "-" if seconds < 0 else "+"
    s = abs(seconds)
    text = f"{sign}{s // 3600:02d}:{s // 60 % 60:02d}"
    return text + (f":{s % 60:02d}" if s % 60 else "")


def iso_local(ms, zone):
    local = at(ms).astimezone(zone)
    off = int(local.utcoffset().total_seconds())
    frac = f".{local.microsecond // 1000:03d}" if local.microsecond else ""
    return f"{local.year:04d}-{local.month:02d}-{local.day:02d}T{local.hour:02d}:{local.minute:02d}:{local.second:02d}{frac}{offset_text(off)}", off


def is_dst(ms, zone):
    d = at(ms).astimezone(zone).dst()
    return bool(d) and d != timedelta(0)


def offset_at(ms, zone):
    return int(at(ms).astimezone(zone).utcoffset().total_seconds())


def changes_in_year(zone, year):
    """Instants (ms) where the zone's offset changes in the year, to the second (day scan, then bisection)."""
    found = []
    t = ms_of(datetime(year, 1, 1, tzinfo=timezone.utc))
    end = ms_of(datetime(year + 1, 1, 1, tzinfo=timezone.utc))
    prev = offset_at(t, zone)
    while t < end:
        nxt = min(t + 86_400_000, end)
        off = offset_at(nxt, zone)
        if off != prev:
            lo, hi = t, nxt
            while hi - lo > 1000:
                mid = lo + (hi - lo) // 2
                if offset_at(mid, zone) == prev:
                    lo = mid
                else:
                    hi = mid
            found.append(hi)
        prev, t = off, nxt
    return found


def pick_instant(rng, zone):
    r = rng.random()
    if r < 0.5:
        lo, hi = datetime(1900, 1, 1, tzinfo=timezone.utc), datetime(2040, 1, 1, tzinfo=timezone.utc)
    elif r < 0.83:
        for _ in range(4):
            year = rng.randint(1970, 2037)
            changes = changes_in_year(zone, year)
            if changes:
                c = rng.choice(changes)
                return c + rng.randint(-6 * 3600, 6 * 3600) * 1000 + rng.choice([0, 0, 0, rng.randint(0, 999)])
        lo, hi = datetime(1970, 1, 1, tzinfo=timezone.utc), datetime(2037, 1, 1, tzinfo=timezone.utc)
    else:
        if rng.random() < 0.5:
            lo, hi = datetime(1800, 1, 1, tzinfo=timezone.utc), datetime(1900, 1, 1, tzinfo=timezone.utc)
        else:
            lo, hi = datetime(2040, 1, 1, tzinfo=timezone.utc), datetime(2400, 1, 1, tzinfo=timezone.utc)
    return rng.randint(ms_of(lo), ms_of(hi))


def days_in_month(y, m):
    if m == 2:
        return 29 if (y % 4 == 0 and y % 100 != 0) or y % 400 == 0 else 28
    return 30 if m in (4, 6, 9, 11) else 31


def resolve_wall(wall, zone):
    """fold=0 instant of a naive wall time, and gap / overlap / exact."""
    first = wall.replace(tzinfo=zone, fold=0)
    second = wall.replace(tzinfo=zone, fold=1)
    ms0, ms1 = ms_of(first), ms_of(second)
    if ms0 == ms1:
        kind = "exact"
    else:
        # A wall time in a gap does not come back from its instant; one in an overlap does, from both.
        back0 = at(ms0).astimezone(zone).replace(tzinfo=None)
        kind = "overlap" if back0 == wall else "gap"
    return ms0, kind


def main():
    zones_path, seed, count = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    wanted = json.load(open(zones_path))
    have = available_timezones() | {"UTC"}
    zones = [z for z in wanted if z in have]
    missing = [z for z in wanted if z not in have]
    rng = random.Random(seed)
    out = {"tzdata": None, "zones": len(zones), "missing": missing, "cases": [], "offsets": {}}
    try:
        for line in open("/usr/share/zoneinfo/tzdata.zi"):
            out["tzdata"] = line.strip().replace("# version ", "")
            break
    except OSError:
        pass

    for i in range(count):
        z = rng.choice(zones)
        zone = ZoneInfo(z)
        t = pick_instant(rng, zone)
        kind = ("wall", "resolve", "add_days", "add_months")[i % 4]
        case = {"kind": kind, "zone": z, "t": t}
        if kind == "wall":
            case["iso"], case["offset"] = iso_local(t, zone)
            case["dst"] = is_dst(t, zone)
        elif kind == "resolve":
            local = at(t).astimezone(zone).replace(tzinfo=None, microsecond=0)
            # Around the moment, on a quarter-hour: walks into gaps and overlaps near clock changes.
            wall = local.replace(second=0, minute=local.minute // 15 * 15) + timedelta(minutes=15 * rng.randint(-8, 8))
            case["wall"] = wall.strftime("%Y-%m-%dT%H:%M:%S")
            case["expected"], case["resolution"] = resolve_wall(wall, zone)
        elif kind == "add_days":
            n = rng.randint(-800, 800)
            extra = rng.choice([0, 0, rng.randint(-86_400_000, 86_400_000)])
            local = at(t).astimezone(zone).replace(tzinfo=None)
            moved, res = resolve_wall(local + timedelta(days=n), zone)
            case.update({"days": n, "ms": extra, "expected": moved + extra})
        else:
            months = rng.randint(-400, 400)
            n = rng.randint(-40, 40)
            extra = rng.choice([0, 0, rng.randint(-86_400_000, 86_400_000)])
            local = at(t).astimezone(zone).replace(tzinfo=None)
            index = local.year * 12 + (local.month - 1) + months
            y, m = index // 12, index % 12 + 1
            if not 1 <= y <= 9998:
                continue
            day = min(local.day, days_in_month(y, m))
            wall = local.replace(year=y, month=m, day=day) + timedelta(days=n)
            moved, res = resolve_wall(wall, zone)
            case.update({"months": months, "days": n, "ms": extra, "expected": moved + extra})
        out["cases"].append(case)

    instants = [ms_of(datetime(y, m, 1, tzinfo=timezone.utc)) for y in range(1900, 2101) for m in range(1, 13)]
    out["instants"] = instants
    for z in zones:
        zone = ZoneInfo(z)
        out["offsets"][z] = [offset_at(t, zone) for t in instants]
    json.dump(out, sys.stdout)


main()
