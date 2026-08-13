#!/usr/bin/env python3
"""Fetch Premier League matchweek pages and extract fixtures into fixtures.json

Usage: python3 scripts/fetch_matchweeks.py
"""
import re
import json
from pathlib import Path
import requests

BASE = 'https://www.premierleague.com/en/matches/premier-league/2026-27/matchweek-{}'
CLUBS = [
    'Arsenal','Aston Villa','Bournemouth','Brentford','Brighton & Hove Albion','Chelsea',
    'Coventry City','Crystal Palace','Everton','Fulham','Hull City','Ipswich Town','Leeds United',
    'Liverpool','Manchester City','Manchester United','Newcastle United','Nottingham Forest',
    'Sunderland','Tottenham Hotspur'
]

def extract_from_html(html: str):
    html = html.replace('&amp;', '&').replace('\xa0', ' ')
    sep = r'(?:\s+v\s+|\s+vs\s+|\s+vs\.\s+|\s+[–—-]\s+)'
    pattern = re.compile(r'([A-Z][A-Za-z0-9 &\-\']+?)' + sep + r'([A-Z][A-Za-z0-9 &\-\']+?)')
    matches = []
    for m in pattern.finditer(html):
        a = m.group(1).strip(); b = m.group(2).strip()
        if a.lower().startswith('afc '): a = a[4:]
        if b.lower().startswith('afc '): b = b[4:]
        a = re.sub(r"\s*\(.*\)", '', a).strip(); b = re.sub(r"\s*\(.*\)", '', b).strip()
        ma = next((c for c in CLUBS if c.lower() in a.lower() or a.lower() in c.lower()), None)
        mb = next((c for c in CLUBS if c.lower() in b.lower() or b.lower() in c.lower()), None)
        if ma and mb and ma != mb:
            matches.append({'home': ma, 'away': mb})
    return matches


def main():
    all_matches = []
    for md in range(1, 39):
        url = BASE.format(md)
        print('Fetching', url)
        r = requests.get(url, timeout=15, headers={'User-Agent':'curl','Origin':'https://www.premierleague.com'})
        if r.status_code != 200:
            print('warning: status', r.status_code, 'skipping')
            continue
        m = extract_from_html(r.text)
        print('  found', len(m), 'matches')
        all_matches.extend(m)

    # take first 380 matches
    all_matches = all_matches[:380]
    rounds = [all_matches[i:i+10] for i in range(0, len(all_matches), 10)]
    out = Path('frontend/public/fixtures.json')
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(rounds, indent=2))
    print('Wrote', out, 'rounds:', len(rounds), 'matches:', sum(len(r) for r in rounds))


if __name__ == '__main__':
    main()
