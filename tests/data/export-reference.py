#!/usr/bin/env python3
"""Generate a review candidate from the original source material, without opening SQLite."""
import argparse
import collections
import gzip
import hashlib
import json
import re
import runpy
import unicodedata
import xml.etree.ElementTree as XML
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo
from contract import TABLES, canonical, record

# Public identifiers/attribution are deliberately reviewed independently of the builder.
CREDITS = {
    'TNP': ('pl', 'Toruński Przekład Nowego Przymierza', 'bible', 'input-raw/Biblia_przeklad_Torunski.epub', 'Świadome Chrześcijaństwo, seventh corrected electronic edition (2022).'),
    'UBG': ('pl', 'Uwspółcześniona Biblia Gdańska', 'bible', 'input-raw/UBG_2025.epub', 'Fundacja Wrota Nadziei (2017); electronic edition Logos Media (2017–2024).'),
    'KJV': ('en', 'King James Version', 'bible', 'input-raw/verses-1769.json', 'King James Version, 1769 text. Territorial redistribution review pending.'),
    'TR': ('grc', 'Textus Receptus', 'bible', 'input-raw/gnt.flat.json', 'Bundled GNT Ross text, morphology and definitions. Redistribution review pending.'),
    'Ignatius': ('grc', 'Letters of Ignatius', 'fathers', 'input-raw/ignatius-seven-letters.xml', 'Kirsopp Lake (1912), Perseus / First1KGreek. See input-raw/ignatius-seven-letters.LICENSE.md.'),
    'Interlinear': ('grc', 'Greek Interlinear Translations', 'lexicon', 'input/GreekPolish/interlinear.jsonl.gz', 'Maciej Rapacz, CC BY-NC-SA 4.0. See input/GreekPolish/README.md.'),
    'Supplement': ('grc', 'Greek dictionary supplements', 'lexicon', 'input/GreekPolish/supplement.jsonl.gz', 'Multi-source; see individual entries and input/GreekPolish/README.md.'),
}


def normalized(s):
    return re.sub(r'\s', ' ', re.sub(r'\s+', ' ', s.replace('\u00ad', '')))


def tnp(archive, book):
    xml = XML.fromstring(archive.read(book + '.html').replace(b'&nbsp;', b'&#160;'))
    for p in xml.iter():
        m = re.fullmatch(r'v([0-9]+)\.([1-9][0-9]*)', p.get('id', ''))
        if not m:
            continue
        key = ('TNP', book, int(m[1]), int(m[2]))
        block = p.find('.//*[@class="ct"]').text or ''
        # A printed note's definition begins with its label + space/NBSP.
        # Other semicolons and quoted references to stars stay within its body.
        positions = list(re.finditer(r'(^|;\s*)(\*+|[A-Z0-9][A-Z0-9&:|]*)(?=\s)', block))
        targets = {}
        for index, match in enumerate(positions, 1):
            label = match[2]
            stop = positions[index].start() if index < len(positions) else len(block)
            raw = block[match.end():stop]
            if label in targets or not raw.strip():
                raise ValueError((key, label))
            targets[label] = index
            yield 'verse_footnotes', (*key, index, label, normalized(raw).strip(), raw, match.end(), stop)

        # Iterate XML document order using an explicit stack of nodes and tails.
        stack = [('node', p, (), p.get('id'))]
        ordinal = 0
        while stack:
            event, item, styles, loc = stack.pop()
            kind = 'text'
            target = None
            if event == 'node':
                role = item.get('class')
                if role == 'ct':
                    continue
                if role in ('ca', 'rf', 'st'):
                    kind = {'ca': 'footnoteRef', 'rf': 'crossReference', 'st': 'annotation'}[role]
                    raw = ''.join(item.itertext())
                    if role == 'ca':
                        target = targets[raw.lstrip('|')]
                else:
                    if role in ('jq', 'df'):
                        styles = (*styles, {'jq':'jesus_quote','df':'added_text'}[role])
                    for index, child in reversed(list(enumerate(item))):
                        path = f'{loc}/{index}'
                        stack.append(('text', child.tail, styles, path + '/tail'))
                        stack.append(('node', child, styles, path))
                    raw = item.text
                    loc += '/text'
                    if item is p and raw:
                        raw = re.sub(r'^\s*' + m[2] + r'\.\s*', '', raw)
            else:
                raw = item
            if raw:
                ordinal += 1
                yield 'verse_runs', (*key, ordinal, kind, normalized(raw), canonical(styles), target, raw, loc)


def exact(word):
    chars = unicodedata.normalize('NFD', word.lower())
    return unicodedata.normalize('NFC', ''.join('\u0301' if c == '\u0300' else c for c in chars)).replace('ς','σ')


def strong_key(word):
    # Build lexical spans without disturbing originals stored alongside them.
    spans = []
    current = ''
    for ch in word:
        is_letter = ch.isalpha() and ('\u0370' <= ch <= '\u03ff' or '\u1f00' <= ch <= '\u1fff')
        if is_letter or (current and unicodedata.category(ch).startswith('M')):
            current += ch
        elif current:
            spans.append(current)
            current = ''
    if current:
        spans.append(current)
    return exact(spans[0]) if spans else ''


def records(root):
    # The legacy converter's raw EPUB/TEI/JSON readers are a separate implementation
    # from the snapshot builder's chapter YAML reader.
    converter = runpy.run_path(str(root / 'convert-input-to-output.py'))
    books = converter['BOOKS']
    names = json.loads((Path(__file__).parent / 'polish-book-names.json').read_text())
    osis = {b.abbreviation: b.osis_name for b in books}
    for i, b in enumerate(books, 1):
        yield 'books', (b.osis_name, b.abbreviation, b.kjv_name, names[b.abbreviation], i)
    for key, values in CREDITS.items():
        language, name, kind, locator, credit = values
        path = root / locator
        meta = {}
        if path.suffix == '.gz':
            with gzip.open(path, 'rt') as data:
                meta = json.loads(next(data))
        yield 'sources', (key, language, name, kind, locator, hashlib.sha256(path.read_bytes()).hexdigest(), credit, canonical(meta))
    for value in ('normalizationVersion','schemaVersion'):
        yield 'meta', (value, '1')
    navigation = set()
    documents = {}
    entries = collections.defaultdict(list)
    for edition in ('TNP','UBG','KJV','TR'):
        seen_books = set()
        for book, ch, verse, text in converter['read_' + edition.lower()]():
            yield 'verses', (edition, book.osis_name, ch, verse, text)
            documents[('verse',edition,book.osis_name,ch,verse)] = text
            navigation.add((book.osis_name, ch, verse))
            seen_books.add(book.osis_name)
        for book in seen_books:
            yield 'source_books', (edition, book)
    for key in navigation:
        yield 'navigation', key
    for i, book in enumerate(converter['IGNATIUS_WORKS'], 1):
        yield 'fathers_works', (book.abbreviation, book.kjv_name, i)
    for book, chapter, section, text in converter['read_ignatius']():
        documents[('fathers','Ignatius',book.abbreviation,chapter,section)] = text
        yield 'fathers_passages', (book.abbreviation, chapter, section, text)
    with ZipFile(root / CREDITS['TNP'][3]) as archive:
        for book in books:
            if book.osis_name + '.html' in archive.namelist():
                yield from tnp(archive, book.osis_name)
    senses = {}
    for edition in ('Interlinear', 'Supplement'):
        with gzip.open(root / CREDITS[edition][3], 'rt') as stream:
            next(stream)
            for line in stream:
                r = json.loads(line)
                if 'reference' in r:
                    abbr, ch, v = re.fullmatch(r'(.*?)([0-9]+),([0-9]+)',r['reference']).groups()
                    for i, word in enumerate(r['greek']):
                        sense = {k:r[col][i] for k,col in [('polish','polish'),('english','english'),
                                 ('grammar','grammar'),('code','codes'),('pronunciation','pronunciation')]}
                        yield 'interlinear_tokens', (osis[abbr],int(ch),int(v),i+1, word,*sense.values(),exact(word))
                        senses[(word, 'interlinear', canonical(sense))] = sense
                else:
                    for sense in r['glosses']:
                        label = 'alias' if edition == 'Interlinear' else 'supplement'
                        senses[(r['form'],label,canonical(sense))] = sense
    for i, ((word,source,raw),sense) in enumerate(senses.items(),1):
        entries[exact(word)].extend([word,sense.get('polish'),sense.get('english'),sense.get('lemma')])
        yield 'form_senses', (i,exact(word),word,source,
            *(sense.get(k) for k in ['polish','english','grammar','code','pronunciation','lemma']),raw)
    for key, values in entries.items():
        phrases = dict.fromkeys(s for s in values if s and s.strip() and s != '-')
        documents[('entry','Dictionary',key,0,0)] = ' · '.join(phrases)
    for doc_id,key in enumerate(sorted(documents),1):
        text = documents[key]
        nfd = unicodedata.normalize('NFD', text.lower()).translate(str.maketrans('łς','lσ'))
        folded = ''.join(ch for ch in nfd if unicodedata.category(ch) != 'Mn')
        yield 'search_documents', (doc_id,*key,text,folded)
    for passage in json.loads((root / CREDITS['TR'][3]).read_text()):
        for i,w in enumerate(passage['words'],1):
            yield 'strong_tokens', (passage['book_name_osis'],passage['chapter'],passage['verse'],i,
                w['greek'],strong_key(w['greek']),w.get('strong'),w.get('grammar'),w.get('definition'),
                w.get('dictionary_form'),w.get('transliteration'),w.get('grammar_human'),canonical(w))
    for path in sorted((root/'tags').glob('*.md')):
        raw = path.read_text()
        _,header,body = raw.split('---',2)
        title, _, desc = body.strip().partition('\n')
        yield 'tags', (path.stem,title.removeprefix('# '),desc.strip(),raw)
        members = set()
        for i,expr in enumerate(re.findall(r'^  - (.+)$',header,re.M),1):
            yield 'tag_ranges', (path.stem,i,expr)
            ref, interval = expr.rsplit(',',1)
            first, _, last = interval.partition('-')
            name, chapter = re.fullmatch(r'(.*?)([0-9]+)',ref).groups()
            is_father = name.startswith('Ignatius/')
            book = name.split('/')[-1] if is_father else osis[name]
            for v in range(int(first),int(last or first)+1):
                members.add(('tag_fathers' if is_father else 'tag_verses', (path.stem,book,int(chapter),v)))
        yield from members


def export(repo, target):
    by_table = collections.defaultdict(dict)
    for table, row in records(repo):
        width = TABLES[table][0]
        key = tuple(row[:width])
        if key in by_table[table]:
            raise ValueError(f'Duplicate {table} key {key}')
        by_table[table][key] = record(row, width)
    with ZipFile(target,'x') as archive:
        def add(name, data):
            info = ZipInfo(name, (1980,1,1,0,0,0))
            info.compress_type = ZIP_DEFLATED
            archive.writestr(info, data)
        summary = {}
        for table in TABLES:
            rows = by_table[table]
            data = b''.join(rows[key] for key in sorted(rows))
            summary[table] = {'count':len(rows),'fields':TABLES[table][1].split(),
                              'sha256': hashlib.sha256(data).hexdigest()}
            add(table+'.jsonl',data)
        add('manifest.json', (canonical({'version':1,'tables':summary})+'\n').encode())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=Path('.'))
    parser.add_argument('--output', type=Path, required=True, help='New candidate archive path')
    args = parser.parse_args()
    export(args.repo.resolve(), args.output)
