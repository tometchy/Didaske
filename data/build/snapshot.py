#!/usr/bin/env python3
"""Build the read-only Didaske SQLite snapshot entirely from local source files."""
import argparse
import gzip
import hashlib
import json
import os
import re
import sqlite3
import tempfile
import unicodedata
from pathlib import Path

from tnp import import_tnp

HERE = Path(__file__).resolve().parent
SOURCES = {
    'TNP': ('pl', 'Toruński Przekład Nowego Przymierza', 'bible', 'input-raw/Biblia_przeklad_Torunski.epub', 'Świadome Chrześcijaństwo, seventh corrected electronic edition (2022).'),
    'UBG': ('pl', 'Uwspółcześniona Biblia Gdańska', 'bible', 'input-raw/UBG_2025.epub', 'Fundacja Wrota Nadziei (2017); electronic edition Logos Media (2017–2024).'),
    'KJV': ('en', 'King James Version', 'bible', 'input-raw/verses-1769.json', 'King James Version, 1769 text. Territorial redistribution review pending.'),
    'TR': ('grc', 'Textus Receptus', 'bible', 'input-raw/gnt.flat.json', 'Bundled GNT Ross text, morphology and definitions. Redistribution review pending.'),
    'Ignatius': ('grc', 'Letters of Ignatius', 'fathers', 'input-raw/ignatius-seven-letters.xml', 'Kirsopp Lake (1912), Perseus / First1KGreek. See input-raw/ignatius-seven-letters.LICENSE.md.'),
    'Interlinear': ('grc', 'Greek Interlinear Translations', 'lexicon', 'input/GreekPolish/interlinear.jsonl.gz', 'Maciej Rapacz, CC BY-NC-SA 4.0. See input/GreekPolish/README.md.'),
    'Supplement': ('grc', 'Greek dictionary supplements', 'lexicon', 'input/GreekPolish/supplement.jsonl.gz', 'Multi-source; see individual entries and input/GreekPolish/README.md.'),
}
WORKS = [('Ef', 'To the Ephesians'), ('Mag', 'To the Magnesians'), ('Tral', 'To the Trallians'),
         ('Rz', 'To the Romans'), ('Filad', 'To the Philadelphians'), ('Smyr', 'To the Smyrnaeans'),
         ('Pol', 'To Polycarp')]


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def form_key(word):
    accents = unicodedata.normalize('NFD', word.lower()).replace('\u0300', '\u0301')
    return unicodedata.normalize('NFC', accents).replace('ς', 'σ')


def strong_form_key(surface):
    # The legacy morphology service uses the first lexical Greek word.
    # Preserve the unmodified source surface, including punctuation, separately.
    letters = []
    for character in surface:
        category = unicodedata.category(character)[0]
        greek = 0x370 <= ord(character) <= 0x3ff or 0x1f00 <= ord(character) <= 0x1fff
        if greek and category == 'L' or letters and category == 'M':
            letters.append(character)
        elif letters:
            break
    return form_key(''.join(letters))


def lines(root, subpath, abbr):
    for file in sorted((root / subpath / abbr).glob('*.yml'), key=lambda p: int(p.stem)):
        chapter = int(file.stem)
        for line in file.read_text(encoding='utf-8').splitlines():
            pair = json.loads('{' + line + '}')
            (reference, text), = pair.items()
            prefix = f'{abbr}{chapter},'
            if not reference.startswith(prefix) or not isinstance(text, str) or not text:
                raise ValueError(f'{file}: invalid verse {reference!r}')
            yield chapter, int(reference[len(prefix):]), text


def load_sources(db, repo, books):
    for source, (language, name, kind, locator, credit) in SOURCES.items():
        file = repo / locator
        metadata = {}
        if file.suffix == '.gz':
            with gzip.open(file, 'rt', encoding='utf-8') as stream:
                metadata = json.loads(next(stream))
        db.execute('INSERT INTO sources VALUES (?,?,?,?,?,?,?,?)',
                   (source, language, name, kind, locator, digest(file), credit, compact(metadata)))
    for order, book in enumerate(books, 1):
        db.execute('INSERT INTO books VALUES (?,?,?,?,?)', (book['id'], book['abbr'], book['name_en'], book['name_pl'], order))
    for source in ('TNP', 'UBG', 'KJV', 'TR'):
        for book in books:
            if not (repo / 'input' / source / book['abbr']).is_dir():
                continue
            prefix = (source, book['id'])
            db.execute('INSERT INTO source_books VALUES (?,?)', prefix)
            db.executemany('INSERT INTO verses VALUES (?,?,?,?,?)',
                           (prefix + row for row in lines(repo / 'input', source, book['abbr'])))
    for order, (work, title) in enumerate(WORKS, 1):
        db.execute('INSERT INTO fathers_works VALUES (?,?,?)', (work, title, order))
        db.executemany('INSERT INTO fathers_passages VALUES (?,?,?,?)',
                       ((work, *row) for row in lines(repo / 'input', 'Fathers/Ignatius', work)))


def load_greek(db, repo, abbr):
    senses = {}

    def add_sense(form, source, sense):
        raw = compact(sense)
        senses.setdefault((form, source, raw), (form_key(form), form, source, sense.get('polish'),
                          sense.get('english'), sense.get('grammar'), sense.get('code'),
                          sense.get('pronunciation'), sense.get('lemma'), raw))

    columns = ('greek', 'polish', 'english', 'grammar', 'codes', 'pronunciation')
    with gzip.open(repo / SOURCES['Interlinear'][3], 'rt', encoding='utf-8') as stream:
        meta = json.loads(next(stream))
        if meta['schema'] != 2:
            raise ValueError('Unknown interlinear schema')
        for line in stream:
            record = json.loads(line)
            if 'form' in record:
                for sense in record['glosses']:
                    add_sense(record['form'], 'alias', sense)
                continue
            m = re.fullmatch(r'(.+?)(\d+),(\d+)', record['reference'])
            ref = (abbr[m[1]], int(m[2]), int(m[3]))
            for pos, token in enumerate(zip(*(record[col] for col in columns), strict=True), 1):
                greek, polish, english, grammar, code, pronunciation = token
                db.execute('INSERT INTO interlinear_tokens VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                           (*ref, pos, *token, form_key(greek)))
                add_sense(greek, 'interlinear', dict(polish=polish, english=english, grammar=grammar,
                                                    code=code, pronunciation=pronunciation))
    count = db.execute('SELECT COUNT(*) FROM interlinear_tokens').fetchone()[0]
    if count != meta['words']:
        raise ValueError('Interlinear count mismatch')
    with gzip.open(repo / SOURCES['Supplement'][3], 'rt', encoding='utf-8') as stream:
        meta = json.loads(next(stream))
        if meta['schema'] != 1:
            raise ValueError('Unknown dictionary supplement schema')
        for line in stream:
            record = json.loads(line)
            for sense in record['glosses']:
                add_sense(record['form'], 'supplement', sense)
    db.executemany('INSERT INTO form_senses VALUES (?,?,?,?,?,?,?,?,?,?)', senses.values())
    for row in json.loads((repo / SOURCES['TR'][3]).read_text(encoding='utf-8')):
        ref = (row['book_name_osis'], row['chapter'], row['verse'])
        for pos, word in enumerate(row['words'], 1):
            greek = word['greek']
            db.execute('INSERT INTO strong_tokens VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
                       (*ref, pos, greek, strong_form_key(greek), word.get('strong'), word.get('grammar'),
                        word.get('definition'), word.get('dictionary_form'), word.get('transliteration'),
                        word.get('grammar_human'), compact(word)))


def load_tags(db, repo, abbr):
    for path in sorted((repo / 'tags').glob('*.md')):
        raw = path.read_text(encoding='utf-8')
        fm = re.fullmatch(r'---\nfragments:\n((?:  - [^\n]+\n)+)---\n+(?:# ([^\n]+)\n+)(.*)', raw, re.S)
        if not fm:
            raise ValueError(f'Unrecognized tag format: {path}')
        slug = path.stem
        db.execute('INSERT INTO tags VALUES (?,?,?,?)', (slug, fm[2], fm[3].strip(), raw))
        for i, line in enumerate(fm[1].splitlines(), 1):
            expr = line[4:].strip()
            m = re.fullmatch(r'(Ignatius/)?(.+?)(\d+),(\d+)(?:-(\d+))?', expr)
            if not m:
                raise ValueError(f'Unsupported tag range at {path}: {expr}')
            chapter, first, last = int(m[3]), int(m[4]), int(m[5] or m[4])
            db.execute('INSERT INTO tag_ranges VALUES (?,?,?)', (slug, i, expr))
            if last < first:
                raise ValueError(f'Reversed range at {path}: {expr}')
            for number in range(first, last + 1):
                if m[1]:
                    db.execute('INSERT OR IGNORE INTO tag_fathers VALUES (?,?,?,?)', (slug, m[2], chapter, number))
                else:
                    key = (abbr[m[2]], chapter, number)
                    if not db.execute('SELECT 1 FROM verses WHERE book_id=? AND chapter=? AND verse=? LIMIT 1', key).fetchone():
                        raise ValueError(f'Missing tagged reference {key}')
                    db.execute('INSERT OR IGNORE INTO tag_verses VALUES (?,?,?,?)', (slug, *key))


def load_search(db):
    docs = list(db.execute("SELECT 'verse',source_id,book_id,chapter,verse,text FROM verses"))
    docs.extend(db.execute("SELECT 'fathers','Ignatius',work_id,chapter,ordinal,text FROM fathers_passages"))
    entries = {}
    for key, form, pl, en, lemma in db.execute('SELECT form_key,form,polish,english,lemma FROM form_senses ORDER BY rowid'):
        phrases = entries.setdefault(key, {})
        for value in (form, pl, en, lemma):
            if value and value.strip() and value != '-':
                phrases.setdefault(value, None)
    for key, phrases in entries.items():
        docs.append(('entry', 'Dictionary', key, 0, 0, ' · '.join(phrases)))
    for index, doc in enumerate(sorted(docs), 1):
        decomposed = unicodedata.normalize('NFD', doc[-1].lower())
        normalized = ''.join(c for c in decomposed if unicodedata.category(c) != 'Mn')
        db.execute('INSERT INTO search_documents VALUES (?,?,?,?,?,?,?,?)',
                   (index, *doc, normalized.replace('ł', 'l').replace('ς', 'σ')))
    db.execute("INSERT INTO corpus_fts(corpus_fts) VALUES('rebuild')")
    db.execute("INSERT INTO corpus_fts(corpus_fts,rank) VALUES('integrity-check',1)")


def build(repo, db_path):
    books = json.loads((HERE / 'books.json').read_text(encoding='utf-8'))
    abbr = {b['abbr']: b['id'] for b in books}
    db = sqlite3.connect(db_path)
    try:
        db.executescript((HERE / 'schema.sql').read_text(encoding='utf-8'))
        load_sources(db, repo, books)
        import_tnp(db, repo / SOURCES['TNP'][3], books)
        load_greek(db, repo, abbr)
        load_tags(db, repo, abbr)
        load_search(db)
        db.executemany('INSERT INTO meta VALUES (?,?)', [('schemaVersion','1'), ('normalizationVersion','1')])
        if db.execute('PRAGMA foreign_key_check').fetchone() or db.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
            raise RuntimeError('Snapshot integrity check failed')
        counts = dict(db.execute('SELECT source_id, COUNT(*) FROM verses GROUP BY source_id'))
        db.commit()
    finally:
        db.close()
    return {'schemaVersion': 1, 'sha256': digest(db_path), 'bytes': db_path.stat().st_size,
            'verses': counts, 'publicationStatus': 'local-review'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=Path('.'))
    parser.add_argument('--output', type=Path, default=Path('build/content.sqlite3'))
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=args.output.parent) as tmp_dir:
        temp = Path(tmp_dir)
        manifest = build(args.repo, temp / 'content.sqlite3')
        (temp / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
        os.replace(temp / 'content.sqlite3', args.output)
        os.replace(temp / 'manifest.json', args.output.with_name('manifest.json'))
    print(json.dumps(manifest))


if __name__ == '__main__':
    main()
