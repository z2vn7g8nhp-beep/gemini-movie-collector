"""Extract credited name pairs from cast lists on IMDb-ID-linked English Wikipedia pages."""
import argparse
import html
import json
import re
import time
from urllib.error import HTTPError
from pathlib import Path
from urllib.parse import urlencode, unquote, urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "src/data/role-pairs"
AGENT = "CineArchive/1.0 (https://github.com/z2vn7g8nhp-beep/gemini-movie-collector)"

def get(endpoint, params):
    req = Request(endpoint + "?" + urlencode(params), headers={"User-Agent": AGENT})
    for attempt in range(4):
        try:
            with urlopen(req, timeout=40) as response:
                return json.load(response)
        except HTTPError as exc:
            if exc.code not in (429, 502, 503, 504) or attempt == 3:
                raise
            retry = exc.headers.get("Retry-After", "")
            time.sleep(max(int(retry) if retry.isdigit() else 30, 2 ** attempt))

def credited_name(text):
    text = re.sub(r"\[\[(?:[^\[\]|]+\|)?([^\[\]]+)\]\]", r"\1", text.strip())
    text = html.unescape(text).strip().strip("'").strip()
    # Accept short names only. Skip prose, templates, references and ambiguous lists.
    if (not text or len(text) > 65 or len(text.split()) > 7 or
        not text[0].isupper() or any(not (c.isalnum() or c in " -.·’'") for c in text)):
        return None
    return text

def cast_pairs(wikitext):
    section = re.search(r"^==\s*(?:Voice cast|Cast(?: and characters)?|Starring)\s*==\s*$([\s\S]*?)(?=^==[^=]|\Z)", wikitext, re.M | re.I)
    pairs = []
    if section:
        for line in section[1].splitlines():
            line = re.sub(r"<ref\b[^>]*?/>|<ref\b[^>]*>.*?</ref>", "", line, flags=re.I)
            line = re.split(r"<ref\b|<!--", line, maxsplit=1, flags=re.I)[0]
            match = re.match(r"^\*\s*([^*].*?)\s+as\s+(.+?)\s*$", line)
            if not match:
                continue
            actor = credited_name(match[1])
            role = credited_name(re.split(r"[:,]|\s+[–—]\s+", match[2], maxsplit=1)[0])
            if actor and role and [actor, role] not in pairs:
                pairs.append([actor, role])
    return pairs

def fetch_pairs(ids):
    query = """SELECT ?id ?page WHERE { VALUES ?id { %s }
      ?work wdt:P345 ?id. ?page schema:about ?work; schema:isPartOf <https://en.wikipedia.org/>. }""" % " ".join(map(json.dumps, ids))
    rows = get("https://query.wikidata.org/sparql", {"query": query, "format": "json"})["results"]["bindings"]
    by_title = {unquote(urlsplit(r["page"]["value"]).path[6:]).replace("_", " "): r["id"]["value"] for r in rows}
    titles = list(by_title)
    results = {}
    for offset in range(0, len(titles), 16):
        pages = get("https://en.wikipedia.org/w/api.php", {
            "action": "query", "format": "json", "formatversion": 2, "prop": "revisions",
            "rvprop": "ids|content", "rvslots": "main", "titles": "|".join(titles[offset:offset+16]),
        })["query"]["pages"]
        for page in pages:
            rev = next(iter(page.get("revisions", [])), None)
            if rev and page["title"] in by_title:
                pairs = cast_pairs(rev["slots"]["main"]["content"])
                if pairs:
                    results[by_title[page["title"]]] = [rev["revid"], pairs]
    return results

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
