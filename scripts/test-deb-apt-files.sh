#!/usr/bin/env bash
# Check that the Pergament .deb registers the apt repository: it ships the
# sources file and the keyring, and removing or purging the package never
# leaves the sources file behind without its keyring. Installs the deb in a
# debian:12 container. Updates the index only before the deb is installed, so
# the live repository is never queried. Needs docker and dpkg-deb.
#   scripts/test-deb-apt-files.sh DEB
set -euo pipefail
die() { echo "test-deb-apt-files: $*" >&2; exit 1; }

[[ $# -eq 1 ]] || die "usage: scripts/test-deb-apt-files.sh DEB"
deb=$1
[[ -f $deb ]] || die "$deb not found"
deb=$(realpath "$deb")
cd "$(git rev-parse --show-toplevel)"
for t in dpkg-deb docker; do
    command -v "$t" >/dev/null || die "$t is required"
done

sources=/etc/apt/sources.list.d/pergament.sources
keyring=/etc/apt/keyrings/pergament.gpg

tmp=$(mktemp -d /tmp/deb-apt-files.XXXXXX)
cname=
cleanup() {
    [[ -z $cname ]] || docker rm -f "$cname" >/dev/null 2>&1 || true
    rm -rf "$tmp"
}
trap cleanup EXIT

contents=$(dpkg-deb --contents "$deb")
grep -Eq " (\./)?${sources#/}\$" <<<"$contents" || die "contents: $sources missing"
grep -Eq " (\./)?${keyring#/}\$" <<<"$contents" || die "contents: $keyring missing"
for f in "$sources" "$keyring"; do
    grep -Eq "^-rw-r--r-- (root/root|0/0) .* (\./)?${f#/}\$" <<<"$contents" || die "contents: $f is not owned by root with mode -rw-r--r--"
done
echo "ok contents"

dpkg-deb --extract "$deb" "$tmp/root"
cmp "$tmp/root$sources" packaging/apt/pergament.sources || die "sources-text: sources file differs"
cmp "$tmp/root$keyring" packaging/apt/pergament.gpg || die "sources-text: keyring differs"
echo "ok sources-text"

cname=deb-apt-files-$$-$RANDOM
docker run -d --rm --name "$cname" -v "$deb:/pergament.deb:ro" debian:12 sleep 600 >/dev/null
dexec() { docker exec "$cname" "$@"; }
apt_get() { dexec env DEBIAN_FRONTEND=noninteractive apt-get -q "$@"; }
present() { dexec sh -c "test -e $1 && echo yes || echo no"; }

# Update the index on the stock sources, before pergament.sources exists, so
# the Depends resolve. Never update afterwards: the live repository may not
# exist yet.
apt_get update >/dev/null
apt_get install -y /pergament.deb >/dev/null
[[ $(present $sources) == yes ]] || die "remove: $sources not installed"
[[ $(present $keyring) == yes ]] || die "remove: $keyring not installed"
apt_get remove -y pergament >/dev/null
s=$(present $sources) k=$(present $keyring)
[[ $s == "$k" ]] || die "remove: sources present=$s but keyring present=$k"
echo "ok remove"

apt_get install -y /pergament.deb >/dev/null
[[ $(present $sources) == yes ]] || die "purge: $sources not reinstalled"
apt_get purge -y pergament >/dev/null
[[ $(present $sources) == no ]] || die "purge: $sources left behind"
[[ $(present $keyring) == no ]] || die "purge: $keyring left behind"
echo "ok purge"
echo "all checks passed"
