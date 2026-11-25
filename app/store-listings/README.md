# Store listing drafts

The Google Play and App Store folders contain localized text for review. The AppStream metadata uses the existing development Flatpak ID. The English and Polish metadata describe reading functions exercised by the current reader tests.

Run the text checks from the repository root.

```sh
node app/store-listings/check.mjs
appstreamcli validate --no-net app/store-listings/flathub/*.xml
```

Before submitting, select the production identifiers, add verified support/contact and privacy URLs, complete the provider disclosures and age ratings, and capture screenshots on the supported devices from the release candidate. The first store submission also needs a final review of the rights to the packaged editions. Web regression screenshots are available under `tests/visual`. Device screenshots and Flathub screenshot URLs are pending. The listing text describes the public reading features independently of native account setup.

The manual mobile verification workflow uses the development profile. The Android artifact is an ARM64 debug APK. The iOS artifact is a zipped simulator application, locally ad-hoc signed on its macOS runner for launch. Both remain GitHub Actions run artifacts. Signed distribution builds, app store enrollment, device upgrade tests and review are separate release steps.

Field limits and build commands follow the providers' references. [Google Play listing fields](https://support.google.com/googleplay/android-developer/answer/9859152) · [Apple version fields](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/) · [Tauri CLI](https://v2.tauri.app/reference/cli/) · [Tauri CLI 2.12.6 simulator packaging](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.6/crates/tauri-cli/src/mobile/ios/build.rs)
