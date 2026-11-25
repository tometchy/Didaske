"""Independently verify the Pages artifact, SQLite navigation and locale sitemaps."""
import argparse
import gzip
import hashlib
import io
import json
import sqlite3
import sys
import tarfile
from collections import Counter
from pathlib import Path
from urllib.parse import unquote, urlsplit
from xml.etree import ElementTree as ET

root = Path(__file__).resolve().parents[2]
dist = root / "app/dist-preview"
config = json.loads((root / "app/src/app-config.json").read_bytes())
base_url = config["siteOrigin"].rstrip("/") + config["basePath"]
sitemap = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
xhtml = "{http://www.w3.org/1999/xhtml}"
families = {
    "verse": ("Biblia/Werset/{}/{}/{}/", "SELECT DISTINCT b.abbr,v.chapter,v.verse FROM verses v JOIN books b USING(book_id)"),
    "chapter": ("Biblia/{}/{}/{}/", "SELECT DISTINCT source_id,b.abbr,v.chapter FROM verses v JOIN books b USING(book_id)"),
    "note": ("Study/TNP/{}/{}/{}/notes/{}/", "SELECT b.abbr,v.chapter,v.verse,v.note_ordinal FROM verse_footnotes v JOIN books b USING(book_id)"),
    "word": ("Study/TR/{}/{}/{}/words/{}/", "SELECT b.abbr,v.chapter,v.verse,v.position FROM strong_tokens v JOIN books b USING(book_id)"),
    "entry": ("Dictionary/{}/", "SELECT DISTINCT form_key FROM form_senses"),
}

def relative(url):
    if not url.startswith(base_url):
        raise ValueError("Unexpected origin or base path in " + url)
    result = unquote(url[len(base_url):])
    if ".." in result.split("/") or result.startswith("/") or urlsplit(url).query:
        raise ValueError("Unsafe sitemap path " + url)
    return result

def read_sitemap(compressed, seen, locales):
    for entry in ET.fromstring(gzip.decompress(compressed)).iterfind(sitemap + "url"):
        path = relative(entry.findtext(sitemap + "loc"))
        locale, rest = path.split("/", 1)
        if locale not in ("pl", "en") or path in seen:
            raise ValueError("Unexpected locale or duplicate in sitemap: " + path)
        seen.add(path)
        alternates = [(link.get("hreflang"), relative(link.get("href")))
                      for link in entry.findall(xhtml + "link") if link.get("rel") == "alternate"]
        if sorted(alternates) != [("en", "en/" + rest), ("pl", "pl/" + rest), ("x-default", "pl/" + rest)]:
            raise ValueError("Incorrect language alternatives: " + path)
        locales[locale] += 1

def verify_archive(seen, locales):
    report = json.loads((root / "build/full-site-report.json").read_bytes())
    digest = hashlib.sha256()
    files, maps = set(), set()
    declared_maps = set()
    db_digest = manifest = None
    size = 0
    with tarfile.open(root / "build/pages.tar", "r|", bufsize=1024*1024) as archive:
        for member in archive:
            path = member.name
            if not member.isfile() or path.startswith("/") or ".." in path.split("/") or path in files:
                raise ValueError("Unexpected tar member: " + path)
            files.add(path)
            payload = archive.extractfile(member).read()
            archive.members.clear()
            digest.update(path.encode("utf8") + b"\x00" + str(len(payload)).encode("ascii") + b"\x00")
            digest.update(payload)
            size += len(payload)
            if path == "sitemap.xml":
                declared_maps = {relative(node.text) for node in ET.fromstring(payload).findall(f".//{sitemap}loc")}
            elif path.startswith("sitemap-") and path.endswith(".xml.gz"):
                maps.add(path)
                read_sitemap(payload, seen, locales)
            elif path == "data/manifest.json":
                manifest = json.loads(payload)
            elif path == "data/content.sqlite3.gz":
                with gzip.GzipFile(fileobj=io.BytesIO(payload)) as source:
                    db_digest = hashlib.file_digest(source, "sha256").hexdigest()
    if size != report["siteBytes"] or len(files) != report["siteFiles"] or digest.hexdigest() != report["memberSha256"]:
        raise ValueError("Archived paths, byte counts or contents differ from the renderer's original payloads")
    if not maps or maps != declared_maps:
        raise ValueError("Sitemap index disagrees with included chunks")
    if db_digest != manifest["sha256"] or manifest != json.loads((root / "build/manifest.json").read_bytes()):
        raise ValueError("Archived database or manifest differs from the verified project snapshot")
    return lambda path: path + "index.html" in files

def verify(use_tar):
    locales = Counter()
    seen = set()
    if use_tar:
        exists = verify_archive(seen, locales)
    else:
        exists = lambda path: (dist / path / "index.html").is_file()
        for node in ET.parse(dist / "sitemap.xml").findall(f".//{sitemap}loc"):
            read_sitemap((dist / relative(node.text)).read_bytes(), seen, locales)
    for path in seen:
        if not exists(path):
            raise FileNotFoundError(path)
    counts = Counter()
    with sqlite3.connect(f"file:{root / 'build/content.sqlite3'}?mode=ro", uri=True) as db:
        for kind, (pattern, query) in families.items():
            for row in db.execute(query):
                for locale in ("pl", "en"):
                    path = f"{locale}/{pattern.format(*row)}"
                    if path not in seen:
                        raise ValueError("Missing expected corpus route: " + path)
                    counts[kind] += 1
    if not seen or locales["pl"] != locales["en"]:
        raise ValueError("Unequal or absent locale coverage")
    print(json.dumps({"verifiedSitemapPages": len(seen), "coreRouteCounts": counts, "locales": locales}))

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tar", action="store_true", help="Check build/pages.tar and its render digest")
    try:
        verify(parser.parse_args().tar)
    except (OSError, ValueError, ET.ParseError, tarfile.TarError) as error:
        sys.exit(str(error))
