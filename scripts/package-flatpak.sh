#!/usr/bin/env bash
# Pack the release build into target/package/Pergament-X.Y.Z-linux-x86_64.flatpak
# with a .sha256 file next to it, from packaging/flatpak/io.github.v3rm1n.pergament.json.
# The manifest only stages the built files into /app, so no compilers are needed
# inside the sandbox. Build first:
#   bun run build
#   cargo build --release -p pergament -p pergament-app --features pergament-app/custom-protocol
# The GNOME runtime and SDK from the manifest must be installed:
#   flatpak --user install flathub org.gnome.Platform//50 org.gnome.Sdk//50
set -euo pipefail
die() { echo "package-flatpak: $*" >&2; exit 1; }

version=${1:?usage: scripts/package-flatpak.sh X.Y.Z}
cd "$(git rev-parse --show-toplevel)"
scripts/versions.sh "$version" >/dev/null

app_id=io.github.v3rm1n.pergament
manifest=packaging/flatpak/$app_id.json
[[ -f $manifest ]] || die "$manifest is missing"
for f in target/release/pergament target/release/pergament-app; do
    [[ -x $f ]] || die "$f is missing; build the release first"
done

stage=target/flatpak
rm -rf "$stage" target/flatpak-build target/flatpak-repo
mkdir -p "$stage/bin" "$stage/share/applications" "$stage/share/metainfo" \
    "$stage/share/icons/hicolor/scalable/apps"
install -m755 target/release/pergament target/release/pergament-app "$stage/bin/"
for size in 32 64 128 256; do
    mkdir -p "$stage/share/icons/hicolor/${size}x${size}/apps"
    install -m644 "src-tauri/icons/${size}x${size}.png" \
        "$stage/share/icons/hicolor/${size}x${size}/apps/$app_id.png"
done
mkdir -p "$stage/share/icons/hicolor/512x512/apps"
install -m644 src-tauri/icons/icon.png "$stage/share/icons/hicolor/512x512/apps/$app_id.png"
install -m644 src-tauri/icons/icon.svg "$stage/share/icons/hicolor/scalable/apps/$app_id.svg"
install -m644 "src-tauri/$app_id.metainfo.xml" "$stage/share/metainfo/$app_id.metainfo.xml"

cat >"$stage/share/applications/$app_id.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Pergament
GenericName=Publication Reader
Comment=Pergament, an unofficial Linux reader for .jwpub publications
Exec=pergament-app
Icon=$app_id
Terminal=false
Categories=Office;Viewer;
Keywords=jwpub;Bible;reader;
StartupWMClass=pergament-app
DESKTOP

flatpak-builder --user --arch=x86_64 --default-branch=stable \
    --repo=target/flatpak-repo --force-clean \
    target/flatpak-build "$manifest"
mkdir -p target/package
flatpak build-bundle --arch=x86_64 target/flatpak-repo \
    "target/package/Pergament-$version-linux-x86_64.flatpak" "$app_id" stable
(
    cd target/package
    sha256sum "Pergament-$version-linux-x86_64.flatpak" >"Pergament-$version-linux-x86_64.flatpak.sha256"
)
echo "package-flatpak: target/package/Pergament-$version-linux-x86_64.flatpak"
cat "target/package/Pergament-$version-linux-x86_64.flatpak.sha256"
