"""Build the bundled CC0 Wikidata label index for popular IMDb titles."""
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

if __name__ == "__main__":
    with fetch("https://datasets.imdbws.com/title.ratings.tsv.gz") as response:
        rows = csv.DictReader(io.TextIOWrapper(gzip.GzipFile(fileobj=response)), delimiter="\t")
        popular = heapq.nlargest(2000, rows, key=lambda r: int(r["numVotes"]))
    ids = [r["tconst"] for r in popular]
    records = {}
    for start in range(0, len(ids), 100):
        for row in labels(ids[start:start + 100]):
            records[row[0]] = row
    target = Path(__file__).resolve().parents[1] / "src/data/film-labels.json"
    target.write_text(json.dumps([records[i] for i in ids if i in records], ensure_ascii=False, separators=(",", ":")) + "\n")
