"""Build the bundled CC0 Wikidata label index for popular IMDb titles."""
import argparse
import csv
import gzip
import heapq
import io
import json
import re
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

def fetch(url):
    return urlopen(Request(url, headers={"User-Agent": "CineArchive-film-index/1.0"}), timeout=90)

def labels(ids):
    values = " ".join(json.dumps(i) for i in ids)
    query = """
      SELECT ?id ?zh ?cn ?hans ?en (MIN(YEAR(?date)) AS ?year) WHERE {
        VALUES ?id { %s }
        ?work wdt:P345 ?id.
        OPTIONAL { ?work rdfs:label ?english FILTER(LANG(?english)="en") }
        OPTIONAL { ?work rdfs:label ?general FILTER(LANG(?general)="mul") }
        BIND(COALESCE(?english, ?general, "") AS ?en)
        OPTIONAL { ?work rdfs:label ?cn FILTER(LANG(?cn)="zh-cn") }
        OPTIONAL { ?work rdfs:label ?hans FILTER(LANG(?hans)="zh-hans") }
        OPTIONAL { ?work rdfs:label ?zh FILTER(LANG(?zh)="zh") }
        OPTIONAL { ?work wdt:P577 ?date }
      } GROUP BY ?id ?zh ?cn ?hans ?en
    """ % values
    url = "https://query.wikidata.org/sparql?" + urlencode({"query": query, "format": "json"})
    with fetch(url) as response:
        for row in json.load(response)["results"]["bindings"]:
            record = {k: v["value"] for k, v in row.items()}
            title = next((record[k] for k in ("cn", "hans", "zh") if re.search(r"[\u3400-\u9fff]", record.get(k, ""))), "")
            if title:
                yield [record["id"], title, record["en"], record.get("year", "")]

def update(trending_only):
    target = Path(__file__).resolve().parents[1] / "src/data/film-labels.json"
    records = {row[0]: row for row in json.loads(target.read_text())}
    candidates = {}
    if not trending_only:
        with fetch("https://datasets.imdbws.com/title.ratings.tsv.gz") as response:
            rows = csv.DictReader(io.TextIOWrapper(gzip.GzipFile(fileobj=response)), delimiter="\t")
            for row in heapq.nlargest(6000, rows, key=lambda r: int(r["numVotes"])):
                candidates[row["tconst"]] = None

    for kind in ("movie", "series"):
        with fetch(f"https://v3-cinemeta.strem.io/catalog/{kind}/top.json") as response:
            for item in json.load(response)["metas"]:
                imdb_id = item["id"]
                if re.fullmatch(r"tt\d+", imdb_id):
                    candidates[imdb_id] = item

    ids = list(candidates)
    for start in range(0, len(ids), 100):
        for row in labels(ids[start:start + 100]):
            previous = records.get(row[0], [])
            item = candidates[row[0]]
            if item:
                row[2] = item.get("name") or row[2]
                year = re.search(r"\d{4}", str(item.get("releaseInfo", "")))
                row[3] = row[3] or (year.group() if year else "")
                row.append(item["type"])
            elif previous:
                row[3] = row[3] or previous[3]
                row.extend(previous[4:])
            records[row[0]] = row

    target.write_text(json.dumps(list(records.values()), ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{len(records)} indexed titles")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--trending-only", action="store_true")
    update(parser.parse_args().trending_only)
