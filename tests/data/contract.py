"""Pinned snapshot field order and natural-key width for the independent data review."""
import hashlib
import json

# Each record is ordered by its first N fields for bytewise, typed-key comparison.
TABLES = {
    'meta': (1, 'key value'),
    'sources': (1, 'source_id language name kind locator sha256 attribution metadata'),
    'books': (1, 'book_id abbr name_en name_pl position'),
    'source_books': (2, 'source_id book_id'),
    'verses': (4, 'source_id book_id chapter verse text'),
    'verse_runs': (5, 'source_id book_id chapter verse ordinal kind text styles note_ordinal raw_text locator'),
    'verse_footnotes': (5, 'source_id book_id chapter verse note_ordinal label body raw_body start_offset end_offset'),
    'fathers_works': (1, 'work_id name_en position'),
    'fathers_passages': (3, 'work_id chapter ordinal text'),
    'tags': (1, 'slug title description markdown'),
    'tag_ranges': (2, 'slug ordinal fragment'),
    'tag_verses': (4, 'slug book_id chapter verse'),
    'tag_fathers': (4, 'slug work_id chapter ordinal'),
    'interlinear_tokens': (4, 'book_id chapter verse position greek polish english grammar code pronunciation form_key'),
    'strong_tokens': (4, 'book_id chapter verse position greek form_key strong grammar definition lemma transliteration grammar_human raw_record'),
    'form_senses': (1, 'rowid form_key form source polish english grammar code pronunciation lemma raw_record'),
    'search_documents': (1, 'doc_id kind source target chapter verse text normalized'),
    'navigation': (3, 'book_id chapter verse'),
}


def canonical(values):
    return json.dumps(values, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def record(row, width):
    return canonical([*row[:width], hashlib.sha256(canonical(row).encode()).hexdigest()]).encode() + b'\n'
