#!/usr/bin/env python3
"""Simple helper to import fixtures from CSV/JSON into frontend/public/fixtures.json

CSV format (columns): matchday,home,away

Usage:
  python3 scripts/import_fixtures.py fixtures.csv
  python3 scripts/import_fixtures.py fixtures.json

The script writes `frontend/public/fixtures.json` as an array of rounds,
each round is an array of {"home": "Club", "away": "Club"}.
"""
import sys
import json
from pathlib import Path


def from_csv(p: Path):
    import csv
    rows = []
    with p.open() as fh:
        r = csv.DictReader(fh)
        for row in r:
            rows.append(row)
    # group by matchday
    by_md = {}
    for row in rows:
        md = int(row.get('matchday') or row.get('round') or 0)
        by_md.setdefault(md, []).append({'home': row['home'].strip(), 'away': row['away'].strip()})
    rounds = [by_md[k] for k in sorted(by_md.keys())]
    return rounds


def from_json(p: Path):
    j = json.loads(p.read_text())
    # assume either list of rounds, or flat list of matches with matchday
    if isinstance(j, list) and len(j) and isinstance(j[0], list):
        return j
    if isinstance(j, list) and len(j) and isinstance(j[0], dict):
        # expect dicts with matchday/home/away
        by_md = {}
        for row in j:
            md = int(row.get('matchday') or row.get('round') or 0)
            by_md.setdefault(md, []).append({'home': row['home'], 'away': row['away']})
        return [by_md[k] for k in sorted(by_md.keys())]
    raise SystemExit('Unrecognized JSON format')


def main():
    if len(sys.argv) < 2:
        print('Usage: import_fixtures.py fixtures.csv|fixtures.json')
        raise SystemExit(2)
    p = Path(sys.argv[1])
    if not p.exists():
        raise SystemExit('file not found: ' + str(p))
    if p.suffix.lower() == '.csv':
        rounds = from_csv(p)
    else:
        rounds = from_json(p)
    out = Path('frontend/public/fixtures.json')
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(rounds, indent=2))
    print('Wrote', out)


if __name__ == '__main__':
    main()
