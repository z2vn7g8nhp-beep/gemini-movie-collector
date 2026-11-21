"""Extract credited name pairs from cast lists on IMDb-ID-linked English Wikipedia pages."""
import argparse
import json
import re
from pathlib import Path
from urllib.parse import unquote, urlsplit
from wiki_cast import get, page_pairs

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "src/data/role-pairs"
def fetch_pairs(ids):
    query = """SELECT ?id ?page WHERE { VALUES ?id { %s }
      ?work wdt:P345 ?id. ?page schema:about ?work; schema:isPartOf <https://en.wikipedia.org/>. }""" % " ".join(map(json.dumps, ids))
    rows = get("https://query.wikidata.org/sparql", {"query": query, "format": "json"})["results"]["bindings"]
    by_title = {unquote(urlsplit(r["page"]["value"]).path[6:]).replace("_", " "): r["id"]["value"] for r in rows}
    return page_pairs(by_title)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ids", nargs="+", help="refresh specific IMDb titles only")
    args = parser.parse_args()
    ids = args.ids or [r[0] for r in json.loads((ROOT / "src/data/film-labels.json").read_text())]
    OUT.mkdir(parents=True, exist_ok=True)
    groups = {}
    for imdb in ids:
        if not re.fullmatch(r"tt\d{5,10}", imdb):
            raise ValueError(imdb)
        groups.setdefault(imdb[-2:], []).append(imdb)

    def refresh(group):
        key, titles = group
        path = OUT / f"role-pairs-{key}.json"
        data = json.loads(path.read_text()) if path.exists() else {}
        for i in range(0, len(titles), 40):
            data.update(fetch_pairs(titles[i:i+40]))
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")
        tmp.replace(path)
        print(key, len(data), flush=True)

    for group in groups.items():
        refresh(group)

if __name__ == "__main__":
    main()
