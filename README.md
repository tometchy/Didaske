# Didaske

Didaske is a Polish and English Bible reader built with Tauri 2, JavaScript and SQLite. The installed app bundles its texts and reads offline. The same views generate directly addressable HTML for the public website.

## Run the Linux reader

On the migration laptop, launch the locally built executable from this checkout:

```sh
./build/native/didaske
```

The tested GNOME 51 Flatpak is available locally at `build/native/Didaske.flatpak`. Install and open it with:

```sh
flatpak install --user ./build/native/Didaske.flatpak
flatpak run --branch=dev com.didaske.Didaske.Dev
```

Use `./build/native/didaske --self-test` to check the embedded database. The executable uses the system GTK 3 and WebKitGTK 4.1 runtime. Local packages and build products live under the ignored `build/` directory.

## Build from source

Use Node 24+, Python 3.11+ with SQLite FTS5, a Rust toolchain compatible with Cargo.lock, and the Tauri 2 development prerequisites for your OS. Run from the repository root:

```sh
npm --prefix app ci
(cd app && npm run tauri -- build --no-bundle)
```

The Tauri preparation step rebuilds the snapshot and native frontend. On Linux the built executable is normally `app/src-tauri/target/release/didaske`.

For a browser preview including static sample pages and the full searchable SQLite database:

```sh
python3 data/build/snapshot.py
npm --prefix app run build
python3 -m http.server --bind 127.0.0.1 --directory app/dist 8000
```

Open `http://127.0.0.1:8000/pl/` or `http://127.0.0.1:8000/en/`. The sample includes John 1–4. The full local Pages build is `npm --prefix app run build:pages:preview` and writes to `app/dist-preview/`. To produce the complete site as one local archive, use `npm --prefix app run build:pages:tar` and verify its contents with `python3 app/scripts/check-pages.py --tar`. [Site measurements](docs/migration/pages-measurement.md) document page coverage and the hosting budget.

## Verify a checkout

```sh
bash scripts/setup-visual-tests.sh --with-deps
python3 -m unittest discover -s tests
python3 data/build/snapshot.py
python3 tests/data/check-content-integrity.py
node --test tests/data/integrity.test.mjs
npm --prefix app test
env -u KDJ_VISUAL_BASE_URL bash scripts/test-screenshots.sh
```

The screenshot runner builds the current sources, serves them at an isolated loopback address and tests Polish/English desktop and mobile views. Open `screenshots/report/index.html` for results. The [corpus verification guide](tests/data/README.md) describes checks against the independent source archive.

## Project status and sources

Read the [implementation checkpoint](docs/migration/progress.md) for verified behavior and remaining release gates. The [roadmap](docs/migration/migration-roadmap.md) records the complete migration and cutover criteria. Public web reading is anonymous and read-only. Native GitHub sign-in requires registration of a GitHub App and a configured build.

The transferred texts retain their original notices. Application code is licensed under the root [LICENSE](LICENSE). Source and channel-specific conditions are recorded in the [redistribution matrix](docs/migration/repository-audit.md).
