#!/usr/bin/env bash
# Turn a directory of .deb files into a signed flat apt repository (Packages,
# Packages.gz, Release, Release.gpg, InRelease next to the debs) in OUT_DIR.
# Signs with the key whose fingerprint is in APT_KEY_ID, taken from the
# current GNUPGHOME. Needs apt-utils and gnupg:
#   sudo apt-get install apt-utils gnupg
set -euo pipefail
die() { echo "package-apt: $*" >&2; exit 1; }

deb_dir=${1:?usage: scripts/package-apt.sh DEB_DIR OUT_DIR}
out_dir=${2:?usage: scripts/package-apt.sh DEB_DIR OUT_DIR}
: "${APT_KEY_ID:?APT_KEY_ID must name the signing key}"
# Resolve before the cd below so relative arguments mean what the caller meant.
deb_dir=$(realpath "$deb_dir")
out_dir=$(realpath -m "$out_dir")
cd "$(git rev-parse --show-toplevel)"

shopt -s nullglob
debs=("$deb_dir"/*.deb)
((${#debs[@]})) || die "no .deb files in $deb_dir"
for tool in apt-ftparchive gpg; do
    command -v "$tool" >/dev/null || die "$tool is required"
done

# OUT_DIR is emptied, so it must not be, or contain, the input directory.
[[ $out_dir != / && $deb_dir != "$out_dir" && $deb_dir != "$out_dir"/* ]] ||
    die "OUT_DIR $out_dir would delete the input debs in $deb_dir"
rm -rf "$out_dir"
mkdir -p "$out_dir"
cp "${debs[@]}" "$out_dir/"

cd "$out_dir"
apt-ftparchive packages . >Packages
gzip -9nk Packages
# Written elsewhere first so Release does not list itself.
release=$(mktemp)
trap 'rm -f "$release"' EXIT
apt-ftparchive \
    -o APT::FTPArchive::Release::Origin=Pergament \
    -o APT::FTPArchive::Release::Label=Pergament \
    -o APT::FTPArchive::Release::Architectures=amd64 \
    release . >"$release"
cp "$release" Release
gpg --batch --yes --local-user "$APT_KEY_ID" --clearsign --output InRelease Release
gpg --batch --yes --local-user "$APT_KEY_ID" --detach-sign --armor --output Release.gpg Release
