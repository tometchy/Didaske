# Didaske implementation checkpoint

## Start here after an interruption

Work in tometchy/Didaske on master. Check `git status --short --branch` and the latest commit first. Preserve the separate KazdyDzienZJezusem checkout and its running service. Build and test commands are in the [project README](../../README.md). The [roadmap](migration-roadmap.md) records acceptance and release gates. Record new results here before context compaction or an expected rate limit.

## Source transfer

The corpus was imported from tometchy/KazdyDzienZJezusem at 47dfc1d1558a7bf7df2199318f84ad6b645200bc. All 3,340 original files in input and input-raw, the source licenses, public tags, tracked Index and editorial material were copied. Public editorial Notes were synchronized to the donor's 6a0c61a142310425f833d49d0bc23ca6ade2219d revision before publication. They are distinct from private GitHub Notes. The owner confirmed permission to place the transferred sources in this public repository. Machine-local secrets, the old Git database, containers and Redis state were excluded. Links in the historical audit point at the original implementation where appropriate.

## Implemented and exercised

- The Linux x86-64 Tauri 2 binary reads its bundled SQLite database offline. The tested binary and GNOME 51 development Flatpak are in build/native on the migration laptop. Rebuild instructions are in README.md.
- PL/EN catalogs, chapters, verse comparisons, TNP notes and Jesus-speech markup, Greek occurrence details and dictionary, search, Ignatius, tags and literature share one renderer across native, browser and static HTML. Dedicated study pages have real URLs. The modal can be docked at four edges. Browser tests cover the retained verse offset, passage changes and independent tabs.
- The read-only browser worker streams a compressed, SHA-256-verified snapshot into OPFS and coordinates access between tabs. The native adapter executes named, parameterized read-only queries against a verified local copy.
- Private Notes implements native GitHub App Device Flow and a pending-only IndexedDB queue. It preserves competing local edits, exports recoverable text, validates repository and account identity, and reconciles lost write responses. Credentials currently live in process memory. Native sign-in requires a separately registered GitHub App. Pages is read-only.
- Google Play, App Store and Flathub draft listings include PL/EN. Hosted verification jobs exist for desktop and mobile development builds.

## Validation on the migration laptop

- `python3 -m unittest discover -s tests` passed 12 converter regressions.
- Two independent snapshot builds produced identical 150,618,112-byte files. SHA-256 is 293a8dcfa9da3b61790cc9052c12b55752436fc342c20a2173cd0cded7a6848c. The checked-in reference ZIP digest is 15342c2665566f363d82a6f3e850925b8bb8fe4fdc33d4da83cf107e30e50e92.
- `python3 tests/data/check-content-integrity.py` compared 84,357 verses, 160,249 TNP runs, 30,096 explanations, 31,102 distinct references, Greek layers, Father passages, tags and full search data. The destination run passed in 59.11 s. An isolated preceding run took 22.60 s. The destination also passed the source fixtures and deliberate corruptions in `node --test tests/data/integrity.test.mjs`.
- `npm --prefix app test` passed all three test files. They cover real reader views in both languages, Greek morphology and Notes reconciliation.
- `env -u KDJ_VISUAL_BASE_URL bash scripts/test-screenshots.sh` passed two CodeceptJS scenarios and 18 Playwright cases on the destination checkout. The browser binaries were reused through PLAYWRIGHT_BROWSERS_PATH. Desktop and phone snapshots cover both modal and dock. During review the mobile panel was widened and reflow was anchored to the selected verse. Both local PDFs were loaded and advanced together.
- The final Linux executable (SHA-256 2b9d5fc66fdf30dfcc3483aee495e151b21bb8fda04b715c509467bedea924c2) and installed test Flatpak (d5589ca090c2599ffcf6ac223c4e90c9dd4fd66a05cb6bfe4b8f6872269124f4) both passed the offline self-test for 84,357 verses and 34 named queries. The actual WebKitWebDriver release smoke exercised the PL/EN chapter, footnote modal and full-page link. The isolated Flatpak used the development identifier com.didaske.Didaske.Dev. A synthetic pending note also survived two separate invocations of the release executable on Linux Mint: every byte and the complete revision-1 record matched after process termination and restart. On the same Mint laptop, an isolated installation of the development Flatpak was upgraded in place from 0.1.0 to 0.1.1. The installed WebView read back the full synthetic revision-1 outbox record at tauri://localhost. All 72 UTF-8 bytes matched SHA-256 e63beca694404c5b79b4b631b008a66377b52a350b1222c8c0feb6ff50938720 before and after the upgrade. The 0.1.1 build was created for this test and retained the development app ID. Upgrade evidence on other platforms is pending.
- The final full local Pages build produced 488,133 served files, 788,552,794 bytes before tar padding, within the 800 MB budget. Vite and the complete archive build finished in 284.64 seconds. The 1,162,405,376-byte POSIX archive and byte report are in build/ on the laptop. The independent destination archive check passed all 453,418 sitemap URLs, split evenly between PL and EN. It checked 62,204 verse comparison pages, 6,454 chapters, 60,192 footnotes, 281,256 word pages and 42,528 dictionary entries. Actual GitHub staging deployment, hosting behavior and timing remain unverified. See [Pages measurements](pages-measurement.md).

## Hosted checks and visual reproducibility — 26 November 2026

The [native matrix for the initial migration](https://github.com/tometchy/Didaske/actions/runs/45667974306) passed for Linux x86-64, Linux ARM64 and Windows. The Linux jobs built, installed and checked the development Flatpak on their runners. Windows built the NSIS installer and ran the executable self-test.

The [first hosted reader run](https://github.com/tometchy/Didaske/actions/runs/45667974589) found a font discrepancy in the four PL/EN note overlay screenshots. After selecting Noto Sans and DejaVu Serif, the [hosted reader checks](https://github.com/tometchy/Didaske/actions/runs/45756674151) and the [three desktop jobs](https://github.com/tometchy/Didaske/actions/runs/45756674193) passed on cc27fe2 with the reviewed laptop images and original pixel thresholds.

Changes to mobile build inputs on master now exercise the Android ARM64 debug APK and the iOS simulator build. Check the **Verify mobile development packages** run for the revision under test. The jobs retain packages only when the operator selects the retention option in a manual run.

## Outstanding acceptance and release work

1. Review the independent reference archive with an editor, including the two source explanations without a printed marker. Confirm any channel-specific distribution rights before publishing packages or Pages.
2. Register and test a real GitHub App on controlled accounts, including selection, reauthorization, repository visibility and token expiry. Prove native queue durability across restarts and two successive installs on each target before enabling private writes for release. Confirm automatic retries and conflict recovery on those targets.
3. Complete shared tag editing and protected-branch contributions against GitHub with effective permissions. The existing public editor remains the writer until an explicitly approved handover.
4. Verify external links and end-to-end deployment size/time on Pages. The manual Pages workflow builds and verifies the site by default. An explicit publication dispatch from master and a configured Pages environment are needed to deploy. Confirm domain control and HTTPS, run the canary and rehearse rollback before moving traffic.
5. Validate remaining architectures, Android/iOS installers and device upgrades. Register stable production identifiers, arrange signing and store enrollment, verify update signatures/recovery, and publish verified download metadata before exposing release links.

The historical service remains available. Production DNS, stores, releases and Cloudflared have not been switched by this migration.
