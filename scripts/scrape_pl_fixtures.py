#!/usr/bin/env python3
"""Scrape PL fixtures page and produce frontend/public/fixtures.json

Heuristic: find occurrences of '<Home> v <Away>' where both names match known clubs,
then group sequential matches into rounds of 10 matches (20 teams -> 10 matches per round).

Usage: python3 scripts/scrape_pl_fixtures.py <url>
"""
import sys
import re
import json
from pathlib import Path


CLUBS = [
    'Arsenal','Aston Villa','Bournemouth','Brentford','Brighton & Hove Albion','Chelsea',
    'Coventry City','Crystal Palace','Everton','Fulham','Hull City','Ipswich Town','Leeds United',
    'Liverpool','Manchester City','Manchester United','Newcastle United','Nottingham Forest',
    'Sunderland','Tottenham Hotspur'
]


def scrape(url: str):
    import requests
    r = requests.get(url, timeout=20)
    text = r.text
    # normalize ampersands and non-breaking spaces
    text = text.replace('&amp;', '&').replace('\xa0', ' ')

    # simple regex for 'Team v Team' allowing parenthetical TV notes and variants like 'vs', en-dash
    sep = r'(?:\s+v\s+|\s+vs\s+|\s+vs\.\s+|\s+[–—-]\s+)'
    pattern = re.compile(r'([A-Z][A-Za-z0-9 &\-\']+?)' + sep + r'([A-Z][A-Za-z0-9 &\-\']+?)')
    matches = []
    for m in pattern.finditer(text):
        a = m.group(1).strip()
        b = m.group(2).strip()
        # normalize variants like 'AFC Bournemouth' -> 'Bournemouth'
        if a.lower().startswith('afc '):
            a = a[4:]
        if b.lower().startswith('afc '):
            b = b[4:]
        # strip trailing parenthesis fragments
        a = re.sub(r"\s*\(.*\)", '', a).strip()
        b = re.sub(r"\s*\(.*\)", '', b).strip()
        # try to match to one of CLUBS using substring (case-insensitive)
        ma = next((c for c in CLUBS if c.lower() in a.lower() or a.lower() in c.lower()), None)
        mb = next((c for c in CLUBS if c.lower() in b.lower() or b.lower() in c.lower()), None)
        if ma and mb and ma != mb:
            matches.append({'home': ma, 'away': mb})

    if not matches:
        raise SystemExit('No matches found')
    # some noise or duplicates may exist; keep order and take first 380 matches
    matches = matches[:380]
    rounds = [matches[i:i+10] for i in range(0, len(matches), 10)]
    out = Path('frontend/public/fixtures.json')
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(rounds, indent=2))
    print('Wrote', out, 'with', len(rounds), 'rounds and', sum(len(r) for r in rounds), 'matches')


def main():
    if len(sys.argv) < 2:
        print('Usage: scrape_pl_fixtures.py <url>')
        raise SystemExit(2)
    scrape(sys.argv[1])


if __name__ == '__main__':
    main()
