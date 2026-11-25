import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const snapshot = resolve(process.env.DIDASKE_SNAPSHOT || 'build/content.sqlite3');
const checker = new URL('./check-content-integrity.py', import.meta.url).pathname;

test('both printed Ruth markers resolve to the same original explanation', () => {
  const db = new DatabaseSync(snapshot, { readOnly: true });
  try {
    const notes = db.prepare(`SELECT r.text, n.body FROM verse_runs r JOIN verse_footnotes n
      USING(source_id,book_id,chapter,verse,note_ordinal)
      WHERE r.book_id='Ruth' AND r.chapter=2 AND r.verse=4 AND r.text='**' ORDER BY r.ordinal`).all();
    assert.equal(notes.length, 2);
    assert.equal(notes[0].body, 'klasyczne formuły pozdrowień - WBCᴷ');
    assert.deepEqual(notes[1], notes[0]);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM verse_footnotes
      WHERE book_id='Ruth' AND chapter=1 AND verse=10`).get().n, 2);
  } finally {
    db.close();
  }
});

test('John preserves the exact quotation boundaries and separate notes', () => {
  const db = new DatabaseSync(snapshot, { readOnly: true });
  try {
    const quote = db.prepare(`SELECT group_concat(text, '') AS text FROM (
       SELECT * FROM verse_runs WHERE book_id='John' AND chapter=1 AND verse=38
       AND kind='text' AND styles LIKE '%jesus_quote%' ORDER BY ordinal)`).get();
    assert.equal(quote.text, 'Czego szukacie?');
    const notes = db.prepare(`SELECT r.text,n.body FROM verse_runs r JOIN verse_footnotes n
       USING(source_id,book_id,chapter,verse,note_ordinal)
       WHERE r.book_id='John' AND r.chapter=3 AND r.verse=16 ORDER BY r.ordinal`).all();
    assert.deepEqual(notes.map(n => n.text), ['*','**']);
    assert.match(notes[0].body, /houto/);
    assert.match(notes[1].body, /agapao/);
    assert.equal(db.prepare(`SELECT text FROM verse_runs WHERE book_id='John' AND chapter=3
      AND verse=16 AND styles='["jesus_quote","added_text"]' AND kind='text'`).get().text, 'właśnie');
  } finally {
    db.close();
  }
});

test('folded queries find complete original records across all reading sources', () => {
  const db = new DatabaseSync(snapshot, { readOnly: true });
  try {
    const kinds = db.prepare(`SELECT DISTINCT d.kind FROM corpus_fts
      JOIN search_documents d ON d.doc_id=corpus_fts.rowid WHERE corpus_fts MATCH ? ORDER BY d.kind`);
    assert.deepEqual(kinds.all('λογοσ').map(d => d.kind), ['entry','fathers','verse']);
    assert.deepEqual(kinds.all('poczatku').map(d => d.kind), ['entry','verse']);
    const word = db.prepare(`SELECT greek,form_key FROM strong_tokens
      WHERE book_id='John' AND chapter=1 AND verse=1 AND position=5`).get();
    assert.equal(word.form_key, 'λόγοσ');
    assert.ok(word.greek.endsWith(','));
  } finally {
    db.close();
  }
});

for (const [name, mutation, table] of [
  ['wrong target in a valid verse', "UPDATE verse_runs SET note_ordinal=2 WHERE book_id='John' AND chapter=3 AND verse=16 AND text='*' AND kind='footnoteRef'", 'verse_runs'],
  ['narration shown as speech', `UPDATE verse_runs SET styles='["jesus_quote"]' WHERE book_id='John' AND chapter=1 AND verse=38 AND ordinal=1`, 'verse_runs'],
  ['missing FTS entry with intact external content', `INSERT INTO corpus_fts(corpus_fts,rowid,normalized)
    SELECT 'delete',doc_id,normalized FROM search_documents WHERE target='John' AND chapter=3 AND verse=16 AND source='KJV'`, 'malformed'],
]) {
  test('full verification rejects ' + name, () => {
    const dir = mkdtempSync(join(tmpdir(), 'didaske-corruption-'));
    try {
      const candidate = join(dir, 'candidate.sqlite3');
      copyFileSync(snapshot, candidate);
      const db = new DatabaseSync(candidate);
      try { db.exec(mutation); } finally { db.close(); }
      const check = spawnSync('python3', [checker, candidate], { encoding:'utf8' });
      assert.equal(check.status, 1, check.stderr);
      assert.ok(check.stderr.includes(table), check.stderr);
    } finally {
      rmSync(dir, { recursive:true, force:true });
    }
  });
}
