# Corpus verification

From the repository root, run with Python 3.11+ (SQLite with FTS5) and Node 24+.

```sh
python3 data/build/snapshot.py
python3 tests/data/check-content-integrity.py
node --test tests/data/integrity.test.mjs
```

The builder writes a private working copy and publishes the completed snapshot and checksum manifest after validating the foreign keys, SQLite pages, FTS5 index and the full TNP text projection. Edition permissions and attribution for redistribution are tracked in [the source audit](../../docs/migration/repository-audit.md). Generated databases and HTML are local build products.

The reference exporter reads the pinned raw Bible sources through the legacy converter. Its TNP parser separately walks the original XML using a stack, locates publisher definition boundaries by their printed labels, and associates each incoming occurrence by label. It independently reconstructs Greek occurrences, alternative senses, search documents, tag range expansions and the reference inventory. Neither the production builder nor its SQLite output is an input. The golden ZIP contains per-record keys and SHA-256 digests in reviewed field order. Synthetic corruptions test a changed note link, an enlarged Jesus quotation and a missing FTS index entry.

The current archive is a candidate for human editorial review. Two definitions have no inline marker in the pinned EPUB, CW in Job 40:6 and the first star in Ps 119:1. Both survive in the note inventory. Every one of the 31,198 printed occurrences resolves to a note, including shared targets such as Ruth 2:4. The source contains 30,096 distinct explanations. Confirm redistribution decisions separately for each channel.

A reference change requires a review of sources and changed records. Create a separate candidate file with `python3 tests/data/export-reference.py --output build/new-reference.zip`, compare it with the frozen archive, and document the reason for each accepted change. Normal comparisons never regenerate the reference. The verifier runs in a subprocess with a 60-second deadline, opens the candidate read-only, checks all declared records and compares the external-content FTS index on a disposable copy.
