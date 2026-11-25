#!/usr/bin/env python3
"""Verify a built SQLite snapshot against the independent frozen source reference."""
import argparse
import hashlib
import itertools
import json
import platform
import sqlite3
import subprocess
import sys
import time
from pathlib import Path
from zipfile import ZipFile
from contract import TABLES, canonical


def check(db_path, reference, expected_hash):
    started = time.monotonic()
    actual_digest = hashlib.sha256(reference.read_bytes()).hexdigest()
    if actual_digest != expected_hash:
        raise ValueError('Golden reference SHA-256 mismatch')
    db = sqlite3.connect(db_path.resolve().as_uri() + '?mode=ro', uri=True)
    if db.execute('PRAGMA user_version').fetchone() != (1,):
        raise ValueError('Unsupported snapshot version')
    if db.execute('PRAGMA quick_check').fetchall() != [('ok',)] or db.execute('PRAGMA foreign_key_check').fetchone():
        raise ValueError('SQLite page/foreign-key verification failed')
    counts = {}
    with ZipFile(reference) as archive:
        names = sorted(['manifest.json', *(k + '.jsonl' for k in TABLES)])
        if sorted(archive.namelist()) != names:
            raise ValueError('Unexpected golden archive members')
        meta = json.loads(archive.read('manifest.json'))
        if meta['version'] != 1 or set(meta['tables']) != set(TABLES):
            raise ValueError('Unexpected golden reference format')
        for table, (width, fields) in TABLES.items():
            cols = fields.split()
            expected = meta['tables'][table]
            if expected['fields'] != cols:
                raise ValueError(f'{table}: unexpected golden fields')
            select = 'SELECT ' + ','.join(cols) + ' FROM ' + table
            if table == 'navigation':
                select = 'SELECT DISTINCT book_id,chapter,verse FROM verses'
            else:
                db_cols = [r[1] for r in db.execute(f'PRAGMA table_info({table})')]
                if set(db_cols) != set(cols) - {'rowid'}:
                    raise ValueError(f'{table}: unexpected SQLite column set')
            rows = db.execute(select + ' ORDER BY ' + ','.join(cols[:width]))
            checksum = hashlib.sha256()
            count = 0
            with archive.open(table+'.jsonl') as source:
                for ref, actual in itertools.zip_longest(source, rows):
                    # Every record hash includes its typed key and all values. The ZIP
                    # SHA pins the independently exported ordered keys and member data.
                    if ref is None or actual is None or not ref.endswith(
                            hashlib.sha256(canonical(actual).encode()).hexdigest().encode() + b'"]\n'):
                        key = list(actual[:width]) if actual else json.loads(ref)[:-1]
                        raise ValueError(f'{table} differs at record {count + 1}, key {key}')
                    count += 1
                    checksum.update(ref)
            if count != expected['count'] or checksum.hexdigest() != expected['sha256']:
                raise ValueError(f'{table}: golden member checksum/count mismatch')
            counts[table] = count
    # FTS integrity-check requires a writable connection. Copy exactly the tested
    # database into RAM, check every indexed external-content row, then discard it.
    temp = sqlite3.connect(':memory:')
    db.backup(temp)
    try:
        temp.execute("INSERT INTO corpus_fts(corpus_fts, rank) VALUES('integrity-check',1)")
    finally:
        temp.close()
        db.close()
    with db_path.open('rb') as stream:
        snapshot_hash = hashlib.file_digest(stream, 'sha256').hexdigest()
    elapsed = time.monotonic() - started
    if elapsed > 60:
        raise TimeoutError(f'Data verification exceeded 60 seconds ({elapsed:.2f}s)')
    print(json.dumps({'seconds':round(elapsed,2),'sqliteVersion':sqlite3.sqlite_version,
                      'platform':platform.system()+' '+platform.machine(),'referenceSha256':actual_digest,
                      'counts':counts,'snapshotSha256':snapshot_hash}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database', nargs='?', type=Path, default=Path('build/content.sqlite3'))
    parser.add_argument('--reference',type=Path, default=Path(__file__).with_name('golden-content-v1.zip'))
    parser.add_argument('--worker',action='store_true',help=argparse.SUPPRESS)
    opts = parser.parse_args()
    if opts.worker:
        digest = opts.reference.with_suffix('.sha256').read_text().split()[0]
        check(opts.database, opts.reference, digest)
    else:
        try:
            sys.exit(subprocess.run([sys.executable,__file__,*sys.argv[1:],'--worker'],timeout=60).returncode)
        except subprocess.TimeoutExpired:
            sys.exit('Full data verification exceeded the 60 second watchdog')
