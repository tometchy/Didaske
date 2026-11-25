"""Recover inline styles and verse-local publisher notes from the TNP source EPUB."""
import json
import re
import xml.etree.ElementTree as ET
from zipfile import ZipFile


def display(raw):
    return re.sub(r'\s+', ' ', raw.replace('\xad', ''))


# These two notes in the pinned edition have a definition but no inline marker.
# Keep the original definition without fabricating an extra clickable marker.
UNREFERENCED = {('Job', 'v40.6'): {'CW'}, ('Ps', 'v119.1'): {'*'}}


def explain(block, markers, unreferenced):
    # Inline references to other verses' notes can themselves contain asterisks.
    # The publisher introduces each *local* definition at the start or after a
    # semicolon using its explicit verse-local label (without the inline pipe).
    labels = {marker.lstrip('|') for marker in markers} | unreferenced
    if not labels and not block.strip():
        return [], {}
    if not labels:
        raise ValueError('Commentary without a marker')
    alternatives = '|'.join(re.escape(s) for s in sorted(labels, key=lambda s: (-len(s), s)))
    pattern = re.compile(r'(?:^\s*|;\s*)(' + alternatives + r')(?=\s)')
    matches = list(pattern.finditer(block))
    if (not matches or matches[0].start() != 0 or len(matches) != len(labels)
            or {m[1] for m in matches} != labels):
        raise ValueError('Ambiguous note labels ' + repr((sorted(labels), block)))
    notes = []
    numbers = {}
    for i, match in enumerate(matches, 1):
        start = match.end()
        end = matches[i].start() if i < len(matches) else len(block)
        raw = block[start:end]
        if not raw.strip():
            raise ValueError('Empty note ' + match[1])
        notes.append((i, match[1], display(raw).strip(), raw, start, end))
        numbers[match[1]] = i
    return notes, numbers


def read_verse(node, verse, book):
    runs = []
    markers = []
    comment = node.find('.//*[@class="ct"]')
    if comment is None:
        raise ValueError('Missing commentary container')
    block = ''.join(comment.itertext())

    def append(kind, raw, styles, locator):
        if raw:
            runs.append((kind, display(raw), json.dumps(styles, separators=(',', ':')), raw, locator))

    def walk(element, styles, path):
        role = element.get('class', '')
        if role == 'ct':
            return
        if role in ('ca', 'rf', 'st'):
            raw = ''.join(element.itertext())
            kind = {'ca': 'footnoteRef', 'rf': 'crossReference', 'st': 'annotation'}[role]
            append(kind, raw, styles, path)
            if role == 'ca':
                markers.append(raw)
            return
        style = {'jq': 'jesus_quote', 'df': 'added_text'}.get(role)
        if style:
            styles = [*styles, style]
        raw = element.text or ''
        if element is node:
            raw = re.sub(r'^\s*' + str(verse) + r'\.\s*', '', raw)
        append('text', raw, styles, path + '/text')
        for i, child in enumerate(element):
            child_path = f'{path}/{i}'
            walk(child, styles, child_path)
            append('text', child.tail, styles, child_path + '/tail')

    walk(node, [], node.attrib['id'])
    notes, targets = explain(block, markers, UNREFERENCED.get((book, node.attrib['id']), set()))
    resolved = [(i, kind, text, style, targets[text.lstrip('|')] if kind == 'footnoteRef' else None,
                 raw, path) for i, (kind, text, style, raw, path) in enumerate(runs, 1)]
    return resolved, notes


def import_tnp(db, path, books):
    rows_seen = 0
    with ZipFile(path) as archive:
        for book in books:
            member = book['id'] + '.html'
            if member not in archive.namelist():
                continue
            doc = ET.fromstring(archive.read(member).replace(b'&nbsp;', b'&#160;'))
            for node in doc.iter():
                match = re.fullmatch(r'v(\d+)\.([1-9]\d*)', node.get('id', ''))
                if not match:
                    continue
                chapter, verse = map(int, match.groups())
                key = ('TNP', book['id'], chapter, verse)
                try:
                    runs, notes = read_verse(node, verse, book['id'])
                except ValueError as exc:
                    raise ValueError(f'{member}#{node.get("id")}: {exc}') from exc
                text = display(''.join(r[2] for r in runs if r[1] == 'text')).strip()
                existing = db.execute('SELECT text FROM verses WHERE (source_id,book_id,chapter,verse)=(?,?,?,?)', key).fetchone()
                if existing != (text,):
                    raise ValueError(f'{key} has conflicting EPUB and chapter text')
                db.executemany('INSERT INTO verse_footnotes VALUES (?,?,?,?,?,?,?,?,?,?)', (key + n for n in notes))
                db.executemany('INSERT INTO verse_runs VALUES (?,?,?,?,?,?,?,?,?,?,?)', (key + r for r in runs))
                rows_seen += 1
    if rows_seen != db.execute("SELECT COUNT(*) FROM verses WHERE source_id='TNP'").fetchone()[0]:
        raise ValueError('TNP coverage differs between source EPUB and converted chapters')
