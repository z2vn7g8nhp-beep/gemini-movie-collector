"""Index recent releases regardless of IMDb vote count or trending rank."""
import argparse
from collections import defaultdict
from datetime import date
import json
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit

from wiki_cast import get, page_pairs

DATA = Path(__file__).resolve().parents[1] / 'src/data'
SERIES = {'Q5398426', 'Q1259759'}
FILMS = {'Q11424', 'Q24869', 'Q229390', 'Q202866', 'Q506240', 'Q29168811'}
UNSPECIFIED = {'Q1107', 'Q15709880'}  # Anime and serials can have different release formats.


def releases(year):
    query = """SELECT ?id ?page ?enpage ?en ?type (MIN(YEAR(?date)) AS ?year) WHERE {
      ?work wdt:P577 ?released. hint:Prior hint:rangeSafe true.
      FILTER(?released >= "%d-01-01T00:00:00Z"^^xsd:dateTime && ?released < "%d-01-01T00:00:00Z"^^xsd:dateTime)
      ?page schema:about ?work; schema:isPartOf <https://zh.wikipedia.org/>.
      ?work wdt:P345 ?id; wdt:P31 ?type; wdt:P577 ?date.
      VALUES ?type { %s }
      OPTIONAL { ?enpage schema:about ?work; schema:isPartOf <https://en.wikipedia.org/>. }
      OPTIONAL { ?work rdfs:label ?en FILTER(LANG(?en)="en") }
    } GROUP BY ?id ?page ?enpage ?en ?type""" % (year, year + 1, ' '.join('wd:' + q for q in sorted(FILMS | SERIES | UNSPECIFIED)))
    rows = get('https://query.wikidata.org/sparql', {'query': query, 'format':  'json'})['results']['bindings']
    return [{k: v['value'] for k, v in row.items()} for row in rows if re.fullmatch(r'tt\d{5,10}', row['id']['value'])]


def page_title(url):
    return unquote(urlsplit(url).path[6:]).replace('_', ' ')


def write(path, data):
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(',', ':')) + '\n')
    tmp.replace(path)


def update(years):
    path = DATA / 'release-profiles.json'
    profiles = json.loads(path.read_text()) if path.exists() else {}
    by_title = defaultdict(list)
    for year in years:
        for row in releases(year):
            title = page_title(row['page'])
            by_title[title].append(row)

    titles = sorted(by_title)
    for i in range(0, len(titles), 16):
        pages = get('https://zh.wikipedia.org/w/api.php', {
            'action': 'query', 'format': 'json', 'formatversion': 2, 'variant': 'zh-cn',
            'prop': 'extracts|info', 'exintro': 1, 'explaintext': 1, 'exlimit': 'max',
            'titles': '|'.join(titles[i:i+16]),
        })['query']['pages']
        for page in pages:
            rows = by_title.get(page['title'], [])
            if len({r['id'] for r in rows}) != 1 or not page.get('lastrevid'):
                continue
            row = rows[0]
            intro = (page.get('extract') or '').strip().split('\n')[0]
            # The first film name in the zh-CN lead uses regional vocabulary conversion.
            named = re.match(r'^《([^《》]+)》', intro)
            title = named[1] if named else re.sub(r'\s*[（(][^()（）]*[)）]$', '', page['title'])
            if not re.search(r'[\u3400-\u9fff]', title):
                continue
            if len(intro) > 320:
                stop = intro.rfind('。', 0, 320)
                intro = intro[:stop+1] if stop > 40 else intro[:320] + '…'
            types = {r['type'].split('/')[-1] for r in rows}
            kind = 'series' if types & SERIES else 'movie' if types & FILMS else ''
            profiles[row['id']] = {
                'title': title, 'alias': page['title'], 'original': row.get('en', ''),
                'year': row['year'], 'kind': kind,
                'summary': intro, 'revision': page['lastrevid'],
                'castPage': page_title(row['enpage']) if row.get('enpage') else '',
            }

    write(path, profiles)
    print(f'{len(titles)} release pages, {len(profiles)} localized profiles', flush=True)


def update_cast():
    profiles = json.loads((DATA / 'release-profiles.json').read_text())
    en_titles = defaultdict(set)
    for imdb, profile in profiles.items():
        if profile.get('castPage'):
            en_titles[profile['castPage']].add(imdb)
    pairs = page_pairs({t: next(iter(ids)) for t, ids in en_titles.items() if len(ids) == 1})
    for suffix in sorted({i[-2:] for i in pairs}):
        shard = DATA / 'role-pairs' / f'role-pairs-{suffix}.json'
        existing = json.loads(shard.read_text()) if shard.exists() else {}
        existing.update({i: p for i, p in pairs.items() if i.endswith(suffix)})
        write(shard, existing)
    print(f'{len(pairs)} cast lists refreshed', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--years', nargs='+', type=int)
    parser.add_argument('--cast-only', action='store_true')
    args = parser.parse_args()
    if args.cast_only:
        update_cast()
    else:
        current = date.today().year
        update(args.years or range(current - 1, current + 2))
