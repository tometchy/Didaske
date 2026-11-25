# Static reader size and route coverage

The local build includes complete Polish and English routes for passages, verse comparisons, TNP footnotes, Greek word occurrences and dictionary entries. The source of truth for a run is its generated `build/full-site-report.json`. The report counts the UTF-8 documents, legacy aliases, sitemaps, bundled assets, compressed database and manifest. Filesystem allocation and the size of a compressed deployment archive answer different questions.

From the repository root, generate the snapshot with `python3 data/build/snapshot.py`, install locked frontend dependencies with `npm --prefix app ci`, then run `npm --prefix app run build:pages:preview`. The complete local artifact is in `app/dist-preview/`. The ordinary `npm --prefix app run build` command makes a smaller sample for browser tests. To sample 1,000 references from each large route family in both languages using the current full-build asset manifest, run `node app/scripts/measure-site.js`. Its weighted estimate is in `build/route-sample-report.json`.

The first complete artifact used 1,462,438,709 bytes across 488,131 files. The static generator took 574.828 seconds on the laptop. This established the cost of repeating the complete navigation shell at every occurrence.

| Initial file group | Files | Bytes |
| --- | ---: | ---: |
| TR occurrence details | 281,256 | 608,967,184 |
| Bible catalogs, chapters and unprefixed Bible aliases | 41,416 | 216,026,263 |
| Verse comparisons | 62,204 | 194,759,748 |
| SQLite and manifest | 2 | 150,618,366 |
| Dictionary | 42,666 | 131,144,888 |
| TNP notes | 60,192 | 124,809,728 |
| Sitemaps | 47 | 33,781,394 |
| Other HTML and assets | 348 | 2,331,138 |

Dedicated details now use the shared body with a compact static document. Each one offers a visible language switch and library navigation, renders without JavaScript and has an absolute self-canonical. The compressed XML sitemaps declare both language versions, each self-reference and the Polish default. The same SQL query allowlist and model render both language versions. Greek study layers load on demand. The browser checks the decompressed snapshot against the same SHA-256 digest as the installed reader. [Google Search Central documents sitemap language annotations](https://developers.google.com/search/docs/specialty/international/localized-versions#sitemap).

## Distribution archive

The intermediate compact directory occupied 805,906,062 bytes across 488,133 files. The next build removes optional HTML syntax while preserving the parsed document. It orders Greek occurrences by passage so the shared renderer reuses each chapter's contextual analysis for successive words in both languages.

Run `npm --prefix app run build:pages:tar` to create `build/pages.tar` directly. This shares the directory generator's inventory, render functions and file payloads. The buffered ustar writer stores only regular files, preserves UTF-8 paths, uses fixed mode and timestamps, and publishes the local archive by renaming its completed temporary file. The reported site size sums the actual files served by Pages. The tar container also includes headers and block padding.

Run `python3 app/scripts/check-pages.py --tar` to read the complete archive alongside the local snapshot. The independent check verifies every member's name, length and contents against the digest of the generator's original payloads. It also checks file uniqueness, every sitemap entry and its language links, every expected chapter, verse, note, word, dictionary route, and the digest of the decompressed database. Run the same command without `--tar` to check the complete directory's sitemap coverage.

## Final local measurement

The 25 November 2026 laptop run of `npm --prefix app run build:pages:tar` generated all 488,133 files in **284.64 seconds including Vite**. The served contents totaled **788,552,794 bytes**, leaving 11,447,206 bytes of headroom against the 800,000,000-byte site budget. The generator's elapsed time was 278.49 seconds. The complete uncompressed tar occupied 1,162,405,376 bytes with file headers and padding. This is a local generation and packaging measurement. The hosted staging upload, Pages deployment and external HTTP checks require their own timing.

| Public content | Final bytes |
| --- | ---: |
| Greek occurrence pages | 354,847,744 |
| Verse comparisons | 144,893,336 |
| Bible chapters | 94,877,016 |
| Dictionary entries | 68,786,520 |
| TNP footnotes | 55,498,070 |
| Compressed public SQLite | 40,676,118 |
| Other files | 28,973,990 |

The SHA-256 digest of the decompressed 150,618,112-byte SQLite snapshot was `293a8dcfa9da3b61790cc9052c12b55752436fc342c20a2173cd0cded7a6848c`. The framed digest of all rendered paths, sizes and contents was `35b368fef69dc74140f68473d2bf4174322b9cdad682e23b35f11e74cd19c2bc`.
