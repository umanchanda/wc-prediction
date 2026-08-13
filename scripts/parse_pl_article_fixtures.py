#!/usr/bin/env python3
"""Parse the Premier League 'All 380 fixtures' article and write fixtures.json

Usage: python3 scripts/parse_pl_article_fixtures.py
"""
import re
import json
import html
from pathlib import Path
import requests

URL = 'https://www.premierleague.com/en/news/4675097/all-380-fixtures-for-202627-premier-league-season'

CLUBS = [
    'Arsenal','Aston Villa','AFC Bournemouth','Bournemouth','Brentford','Brighton & Hove Albion',
    'Chelsea','Coventry City','Crystal Palace','Everton','Fulham','Hull City','Ipswich Town',
    'Leeds United','Liverpool','Manchester City','Manchester United','Newcastle United',
    'Nottingham Forest','Sunderland','Tottenham Hotspur'
]


def find_club(name):
    n = name.lower()
    for c in CLUBS:
        cl = c.lower()
        if cl in n or n in cl:
            return c
    return None


def extract_matches_from_article(html_text: str):
    paras = re.findall(r'<p[^>]*>(.*?)</p>', html_text, flags=re.S)
    matches = []
    for p in paras:
        p2 = p.replace('<br', '\n<br')
        s = re.sub(r'<[^>]+>', '', p2)
        s = html.unescape(s).strip()
        if ' v ' not in s and ' vs ' not in s:
            continue
        for line in s.split('\n'):
            line = line.strip()
            if not line:
                continue
            if ' v ' in line or ' vs ' in line:
                # Remove broadcaster notes in parentheses
                line_clean = re.sub(r'\s*\(.*?\)', '', line).strip()
                m = re.search(r'(.+?)\s+v[s]?\.?\s+(.+)', line_clean, flags=re.I)
                if not m:
                    continue
                a = m.group(1).strip(); b = m.group(2).strip()
                home = find_club(a)
                away = find_club(b)
                if home and away and home != away:
                    matches.append({'home': home, 'away': away})
    return matches


def main():
    print('Downloading article...')
    r = requests.get(URL, headers={'User-Agent': 'curl'}, timeout=20)
    r.raise_for_status()
    html_text = r.text
    matches = extract_matches_from_article(html_text)
    print('Extracted', len(matches), 'matches')
    matches = matches[:380]
    rounds = [matches[i:i+10] for i in range(0, len(matches), 10)]
    out = Path('frontend/public/fixtures.json')
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(rounds, indent=2))
    print('Wrote', out, 'rounds:', len(rounds), 'matches:', sum(len(r) for r in rounds))


if __name__ == '__main__':
    main()
