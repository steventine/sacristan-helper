"""Cross-check generated readings against the USCCB daily-readings pages.

The pipeline builds citations from the US Lectionary index tables. This samples
dates from public/readings.json, fetches the same dates from bible.usccb.org via
the catholic-mass-readings package, and reports any disagreement.

USCCB rate-limits automated access, so requests are paced and the run aborts
after a few consecutive failures rather than hammering the site.

    .venv/Scripts/python.exe scripts/spot_check.py --count 24
    .venv/Scripts/python.exe scripts/spot_check.py --start 2026-11-01 --end 2027-02-01
"""

from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import json
import re
import sys
from pathlib import Path

from catholic_mass_readings import USCCB, models

ROOT = Path(__file__).resolve().parent.parent
READINGS = ROOT / "public" / "readings.json"

# USCCB writes book names out in full ("1 Corinthians", "Isaiah"); the lectionary
# tables abbreviate ("1 Cor", "Is"). Only a leading digit counts as a book number
# - a leading "I" belongs to Isaiah, not to a Roman numeral.
BOOK_RE = re.compile(r"^\s*([1-3]\s+)?([A-Za-z][A-Za-z\s']*?)\s+(\d.*)$")


def canon(citation: str):
    """'1 Corinthians 2:1-5' -> ('1', 'corinthians', '2:1-5')."""
    if not citation:
        return None
    text = citation.replace("—", "-").replace("–", "-").replace(".", "")
    m = BOOK_RE.match(text)
    if not m:
        return ("", re.sub(r"[^a-z]", "", text.lower()), "")
    num, book, verses = m.groups()
    return (
        (num or "").strip(),
        re.sub(r"[^a-z]", "", book.lower()),
        re.sub(r"\s+", "", verses),
    )


def same(a, b) -> bool:
    """Equal book number and verses, with either book name a prefix of the other
    so 'Is' matches 'Isaiah' and 'Matt' matches 'Matthew'."""
    if a[0] != b[0] or a[2] != b[2]:
        return False
    return a[1].startswith(b[1]) or b[1].startswith(a[1])


def options(entries) -> list:
    """Every acceptable form of a citation list, including 'X or Y' branches."""
    out = []
    for e in entries or []:
        for part in re.split(r"\s+or\s+", e["citation"]):
            c = canon(part.strip())
            if c:
                out.append(c)
    return out


def usccb_citations(mass, kind: str) -> list:
    out = []
    for section in mass.sections or []:
        if str(getattr(section, "type_", "")).upper().endswith(kind):
            for r in section.readings or []:
                for part in re.split(r"\s+or\s+", getattr(r, "header", "") or ""):
                    c = canon(part.strip())
                    if c:
                        out.append(c)
    return out


def show(cites) -> list:
    return sorted(" ".join(x for x in (n, b, v) if x) for n, b, v in cites)


def sample(days: dict, args) -> list[str]:
    keys = sorted(days)
    if args.start:
        keys = [k for k in keys if k >= args.start]
    if args.end:
        keys = [k for k in keys if k <= args.end]
    if args.count and len(keys) > args.count:
        step = len(keys) / args.count
        keys = [keys[int(i * step)] for i in range(args.count)]
    return keys


async def main() -> int:
    today = dt.date.today().isoformat()
    p = argparse.ArgumentParser()
    p.add_argument("--count", type=int, default=10, help="how many dates to sample (0 = all in range)")
    p.add_argument("--start", default=today, help="ISO date lower bound")
    p.add_argument("--end", help="ISO date upper bound (default: one year out)")
    p.add_argument("--delay", type=float, default=8.0, help="seconds between requests")
    args = p.parse_args()
    # USCCB only publishes about a year ahead; beyond that every fetch is a 404.
    if not args.end:
        args.end = (dt.date.today() + dt.timedelta(days=365)).isoformat()

    data = json.loads(READINGS.read_text(encoding="utf-8"))
    days = data["days"]
    dates = sample(days, args)
    print(f"checking {len(dates)} of {len(days)} dates, {args.delay}s apart\n")

    mismatches: list[str] = []
    unreachable: list[str] = []
    consecutive_failures = 0
    compared = 0

    async with USCCB() as usccb:
        for i, iso in enumerate(dates):
            rec = days[iso]
            y, m, d = (int(x) for x in iso.split("-"))
            try:
                mass = await usccb.get_mass(dt.date(y, m, d), models.MassType.DEFAULT)
            except Exception as exc:  # network, parse, or block
                mass = None
                detail = str(exc)
                if "404" in detail:
                    # Not published yet - expected for dates far in the future.
                    print(f"  {iso}  not yet published on USCCB")
                    unreachable.append(iso)
                    consecutive_failures = 0
                    await asyncio.sleep(args.delay)
                    continue
                print(f"  {iso}  ERROR {type(exc).__name__}: {detail[:70]}")

            if mass is None:
                unreachable.append(iso)
                consecutive_failures += 1
                if consecutive_failures >= 4:
                    print("\nAborting: 4 consecutive failures - USCCB is likely rate-limiting.")
                    print("Wait a while, raise --delay, and rerun.")
                    break
                await asyncio.sleep(args.delay)
                continue
            consecutive_failures = 0
            compared += 1

            problems = []
            for kind, slot in (("READING", "first"), ("GOSPEL", "gospel")):
                theirs = usccb_citations(mass, kind)
                ours = options(rec.get(slot))
                if not theirs or not ours:
                    continue
                if not any(same(o, t) for o in ours for t in theirs):
                    problems.append(f"{slot}: ours={show(ours)} theirs={show(theirs)}")

            their_title = (mass.title or "").strip()
            title_ok = their_title.lower() == rec["title"].strip().lower()

            if problems:
                mismatches.append(iso)
                print(f"  {iso}  MISMATCH  {rec['title']}")
                for pr in problems:
                    print(f"       {pr}")
                print(f"       USCCB title: {their_title}")
            else:
                flag = "" if title_ok else "  (title differs)"
                print(f"  {iso}  ok  {rec['title']}{flag}")
                if not title_ok:
                    print(f"       USCCB: {their_title}")

            if i < len(dates) - 1:
                await asyncio.sleep(args.delay)

    print(f"\ncompared {compared}   mismatches {len(mismatches)}   unreachable {len(unreachable)}")
    if mismatches:
        print("mismatched dates: " + ", ".join(mismatches))
    return 1 if mismatches else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
