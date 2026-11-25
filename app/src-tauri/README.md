# Didaske installed reader

From the repository root, launch the local Linux build with `./build/native/didaske`. This x86-64 executable uses the laptop's GTK 3 and WebKitGTK 4.1 runtime libraries. Its frontend, fonts used by the bundled styles, and public SQLite snapshot load from the package or the local system. On first use, the reader verifies the snapshot and extracts it into its application data directory. Startup on subsequent launches rechecks the file digest. The development package uses the application ID `com.didaske.Didaske.Dev`.

## Build and check

Install the [Tauri 2 platform prerequisites](https://v2.tauri.app/start/prerequisites/), Node 24, Python 3.11 or newer, and Rust. From the repository root run:

```sh
npm --prefix app ci
(cd app && npm run tauri -- build --no-bundle)
app/src-tauri/target/release/didaske --self-test
```

The build hook prepares `build/content.sqlite3` from the inputs and compiles the native Vite entry point. The self-test extracts the binary's own snapshot into a temporary directory, verifies its digest, SQLite schema and read-only queries, then damages the first bytes and verifies repair. For Linux UI checks, install WebKitWebDriver, Xvfb, xauth and D-Bus. Run:

```sh
xvfb-run -a dbus-run-session -- node app/src-tauri/smoke.mjs app/src-tauri/target/release/didaske tests/visual/reports/native
cargo test --locked --manifest-path app/src-tauri/Cargo.toml --lib
```

On Linux with GNOME Flatpak platform 51 installed, build the development bundle with `app/src-tauri/flatpak/package.sh app/src-tauri/target/release/didaske build/Didaske.flatpak`. The hosted native workflow verifies Linux x86-64/ARM64 and Windows builds when it runs. Platform release, signing, hardware and upgrade gates are tracked in the [release plan](../../docs/migration/releases.md).

## Optional GitHub App configuration

Reading works offline. For a registered GitHub App with Device Flow enabled, set the public `DIDASKE_GITHUB_CLIENT_ID` and numeric `DIDASKE_GITHUB_APP_ID` when compiling the native binary. Device authorization opens GitHub in the system browser. Authorization and polling are explicit reader actions. Credentials live in native process memory until logout or exit. Reauthentication is required when the grant expires. The public website has no native transport.

The device flow and private Notes protocol require a controlled-account trial before release. The native transport checks personal installation membership, account ID, repository ID, exact name, private visibility, branch, namespace tree modes and expected blob SHA. It creates a commit on the verified parent and publishes it through a non-forced reference update. GitHub controls repository visibility; an owner can change visibility concurrently with a request. See the [GitHub App plan](../../docs/migration/github-auth.md).
