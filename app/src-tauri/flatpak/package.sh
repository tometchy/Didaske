#!/usr/bin/env bash
# Build a local test bundle from the just-compiled executable on the same architecture.
set -euo pipefail
binary=$(realpath "${1:?Pass the compiled Didaske executable}")
bundle=$(realpath -m "${2:?Pass a destination .flatpak file}")
assets=$(cd "$(dirname "$0")" && pwd)
app_id=com.didaske.Didaske.Dev
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
# Only the runtime is needed to package an already compiled executable.
flatpak build-init "$stage/app" "$app_id" org.gnome.Platform org.gnome.Platform 51
install -Dm755 "$binary" "$stage/app/files/bin/didaske"
install -Dm644 "$assets/$app_id.desktop" "$stage/app/files/share/applications/$app_id.desktop"
install -Dm644 "$assets/../icons/icon.png" "$stage/app/files/share/icons/hicolor/128x128/apps/$app_id.png"
flatpak build-finish --command=didaske --socket=wayland --socket=fallback-x11 \
  --share=ipc --share=network --device=dri "$stage/app"
flatpak build-export "$stage/repo" "$stage/app" dev
flatpak build-bundle "$stage/repo" "$bundle" "$app_id" dev
