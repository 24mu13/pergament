#!/usr/bin/env bash
# Copy the Tauri bundles into target/package as
# Pergament-X.Y.Z-linux-x86_64.{AppImage,deb,rpm}, each with a .sha256 file
# next to it. Build and bundle first:
#   bun install --frozen-lockfile
#   cargo build --release -p pergament
#   cp target/release/pergament target/release/pergament-x86_64-unknown-linux-gnu
#   bun run tauri build --bundles deb,rpm,appimage \
#       --config '{"bundle":{"active":true,"externalBin":["../target/release/pergament"]}}'
set -euo pipefail
die() { echo "package-bundles: $*" >&2; exit 1; }

version=${1:?usage: scripts/package-bundles.sh X.Y.Z}
cd "$(git rev-parse --show-toplevel)"
scripts/versions.sh "$version" >/dev/null

arch=x86_64
out=target/package
mkdir -p "$out"

shopt -s nullglob
deb=(target/release/bundle/deb/*.deb)
rpm=(target/release/bundle/rpm/*.rpm)
appimage=(target/release/bundle/appimage/*.AppImage)
shopt -u nullglob
((${#deb[@]} == 1)) || die "expected one deb bundle, found ${#deb[@]}"
((${#rpm[@]} == 1)) || die "expected one rpm bundle, found ${#rpm[@]}"
((${#appimage[@]} == 1)) || die "expected one appimage bundle, found ${#appimage[@]}"

install -m644 "$deb" "$out/Pergament-$version-linux-$arch.deb"
install -m644 "$rpm" "$out/Pergament-$version-linux-$arch.rpm"
install -m644 "$appimage" "$out/Pergament-$version-linux-$arch.AppImage"

(
    cd "$out"
    for f in Pergament-"$version"-linux-"$arch".*; do
        [[ $f == *.sha256 ]] && continue
        sha256sum "$f" >"$f.sha256"
    done
)
for f in "$out"/Pergament-"$version"-linux-"$arch".*; do
    echo "package-bundles: $f"
done
cat "$out"/Pergament-"$version"-linux-"$arch".*.sha256
