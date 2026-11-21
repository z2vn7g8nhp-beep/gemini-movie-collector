"""Bundle Wikidata (CC0) cast and role statements for films in the title index."""
import json
from concurrent.futures import ThreadPoolExecutor
import re
import time
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
QUERY = """
SELECT DISTINCT ?id ?job ?person ?personLabel ?personEn ?role ?roleLabel ?roleEn ?name WHERE {
  VALUES ?id { %s }
  ?film wdt:P345 ?id.
  { ?film p:P161 ?credit. ?credit ps:P161 ?person.
    OPTIONAL { ?credit pq:P453 ?role }
    OPTIONAL { ?credit pq:P4633 ?name }
    BIND("cast" AS ?job)
  } UNION { ?film wdt:P57 ?person BIND("director" AS ?job) }
    UNION { ?film wdt:P58 ?person BIND("writer" AS ?job) }
  BIND(COALESCE(?role, ?person) AS ?roleLabelTarget)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "zh-cn,zh-hans,zh,en,mul".
    ?person rdfs:label ?personLabel. ?roleLabelTarget rdfs:label ?roleLabel. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul".
    ?person rdfs:label ?personEn. ?roleLabelTarget rdfs:label ?roleEn. }
}
"""

def load_rows(ids):
    query = QUERY % " ".join(json.dumps(i) for i in ids)
    url = "https://query.wikidata.org/sparql?" + urlencode({"query": query, "format": "json"})
    req = Request(url, headers={"User-Agent": "CineArchive-credits/1.0"})
    try:
        with urlopen(req, timeout=35) as response:
            return json.load(response)["results"]["bindings"]
    except (OSError, ValueError):
        if len(ids) == 1:
            raise
        # Large queries may time out mid-response. Retry with smaller batches.
        middle = len(ids) // 2
        time.sleep(1)
        return load_rows(ids[:middle]) + load_rows(ids[middle:])


def encode(row):
    v = {k: field["value"] for k, field in row.items()}
    person = v["person"].rsplit("/", 1)[-1]
    role = v.get("role", "").rsplit("/", 1)[-1]
    def label(key):
        text = v.get(key, "")
        return "" if re.fullmatch(r"Q\d+", text) else text
    name = label("personLabel") or label("personEn")
    if not name or not re.fullmatch(r"Q\d+", person):
        return None
    original = label("personEn")
    role_en = label("roleEn") if role else ""
    character = (label("roleLabel") if role else "") or label("name") or role_en
    return [v["job"], person, name, original if original != name else "",
            role, character, role_en if role_en != character else ""]

def main():
    ids = [row[0] for row in json.loads((ROOT / "src/data/film-labels.json").read_text())]
    groups = defaultdict(list)
    for imdb in ids:
        groups[imdb[-2:]].append(imdb)
    output = ROOT / "src/data/credits"
    output.mkdir(exist_ok=True)

    def generate(group):
        shard, titles = group
        films = defaultdict(list)
        for start in range(0, len(titles), 20):
            for row in load_rows(titles[start:start + 20]):
                credit = encode(row)
                if credit:
                    films[row["id"]["value"]].append(credit)
        for rows in films.values():
            rows.sort()
        path = output / f"film-credits-{shard}.json"
        temp = path.with_suffix(".tmp")
        temp.write_text(json.dumps(films, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")
        temp.replace(path)
        print(f"{shard}: {len(films)} titles", flush=True)
        return len(films)

    with ThreadPoolExecutor(max_workers=3) as workers:
        count = sum(workers.map(generate, sorted(groups.items())))
    print(count, "films")

if __name__ == "__main__":
    main()
