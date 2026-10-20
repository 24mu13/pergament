#!/usr/bin/env bash
# Check that scripts/package-apt.sh produces a flat apt repository that real
# apt clients in debian:12 and 13 and ubuntu:22.04 and 24.04 can install from, upgrade from and
# verify. Builds throwaway keys, dummy debs and repos, serves them over HTTP on
# localhost and runs the checks in Docker containers. Needs docker, network for
# pulling the base images, and on the host:
#   apt-utils dpkg gnupg python3
set -euo pipefail
die() { echo "test-apt-repo: $*" >&2; exit 1; }

cd "$(git rev-parse --show-toplevel)"
for t in apt-ftparchive dpkg-deb gpg python3 docker; do
    command -v "$t" >/dev/null || die "$t is required"
done

# Short path: gpg-agent's socket path has a length limit.
tmp=$(mktemp -d /tmp/apt-test.XXXXXX)
server_pid=
cname=
cleanup() {
    [[ -z $cname ]] || docker rm -f "$cname" >/dev/null 2>&1 || true
    [[ -z $server_pid ]] || kill "$server_pid" 2>/dev/null || true
    GNUPGHOME=$tmp/g gpgconf --kill gpg-agent 2>/dev/null || true
    rm -rf "$tmp"
}
trap cleanup EXIT

export GNUPGHOME=$tmp/g
mkdir -m700 "$GNUPGHOME"
for name in good other; do
    gpg --batch --quiet --passphrase '' --quick-generate-key "$name <$name@example.invalid>" ed25519 sign never
done
fpr() { gpg --batch --with-colons --list-keys "$1@example.invalid" | awk -F: '/^fpr/ {print $10; exit}'; }
good_fpr=$(fpr good)
other_fpr=$(fpr other)
mkdir "$tmp/keys"
gpg --batch --export "$good_fpr" >"$tmp/keys/good.gpg"

build_deb() {
    local v=$1 root=$tmp/pkg-$1
    mkdir -p "$root/DEBIAN" "$root/usr/bin" "$tmp/debs"
    cat >"$root/DEBIAN/control" <<CTL
Package: pergament
Version: $v
Architecture: amd64
Maintainer: Test <test@example.invalid>
Description: dummy pergament package for apt repository tests
CTL
    printf '#!/bin/sh\necho %s\n' "$v" >"$root/usr/bin/pergament-dummy"
    chmod 755 "$root/usr/bin/pergament-dummy"
    dpkg-deb --root-owner-group --build "$root" "$tmp/debs/pergament_${v}_amd64.deb" >/dev/null
}
build_deb 1.0.0
build_deb 1.1.0

mkdir "$tmp/in1" "$tmp/in2" "$tmp/www"
cp "$tmp/debs/pergament_1.0.0_amd64.deb" "$tmp/in1/"
cp "$tmp/debs"/*.deb "$tmp/in2/"
APT_KEY_ID=$good_fpr scripts/package-apt.sh "$tmp/in1" "$tmp/www/r1"
APT_KEY_ID=$good_fpr scripts/package-apt.sh "$tmp/in2" "$tmp/www/r2"
APT_KEY_ID=$other_fpr scripts/package-apt.sh "$tmp/in1" "$tmp/www/bad"

port=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$tmp/www" >/dev/null 2>&1 &
server_pid=$!
for _ in $(seq 50); do
    python3 -c "import socket; socket.create_connection(('127.0.0.1', $port), 1)" 2>/dev/null && break
    sleep 0.1
done

# OUT_DIR is emptied, so it must be refused when it holds the input debs.
check_unsafe_out_dir() {
    mkdir -p "$tmp/unsafe/in"
    cp "$tmp/in1"/*.deb "$tmp/unsafe/in/"
    local out
    for out in "$tmp/unsafe/in" "$tmp/unsafe" /; do
        if APT_KEY_ID=$good_fpr scripts/package-apt.sh "$tmp/unsafe/in" "$out" >/dev/null 2>&1; then
            die "unsafe-out-dir: accepted OUT_DIR $out"
        fi
        ls "$tmp/unsafe/in"/*.deb >/dev/null 2>&1 || die "unsafe-out-dir: debs deleted for $out"
    done
    echo "ok unsafe-out-dir"
}
check_unsafe_out_dir

# Host-side check on the generated Release file.
check_release_fields() {
    local r=$tmp/www/r2/Release
    grep -qx 'Origin: Pergament' "$r" || die "release-fields: Origin missing"
    grep -qx 'Label: Pergament' "$r" || die "release-fields: Label missing"
    grep -qx 'Architectures: amd64' "$r" || die "release-fields: Architectures missing"
    grep -q '^Date: ' "$r" || die "release-fields: Date missing"
    ! grep -q '^Valid-Until' "$r" || die "release-fields: Valid-Until must not be set"
    echo "ok release-fields"
}
check_release_fields

# Run the client checks inside a fresh container of the given image.
use_repo() { # repo
    dexec sh -c "rm -f /etc/apt/sources.list /etc/apt/sources.list.d/*
cat >/etc/apt/sources.list.d/pergament.sources <<SRC
Types: deb
URIs: http://127.0.0.1:$port/$1/
Suites: ./
Signed-By: /keys/good.gpg
SRC"
}
dexec() { docker exec "$cname" "$@"; }
apt_get() { dexec env DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=0 -q "$@"; }
new_container() {
    [[ -z $cname ]] || docker rm -f "$cname" >/dev/null
    cname=apt-test-$$-$RANDOM
    docker run -d --rm --network host --name "$cname" -v "$tmp/keys:/keys:ro" "$1" sleep 600 >/dev/null
}
dummy_version() { dexec pergament-dummy; }

for image in debian:12 debian:13 ubuntu:22.04 ubuntu:24.04; do
    echo "== $image"

    new_container "$image"
    use_repo r1
    apt_get update >/dev/null
    apt_get install -y pergament >/dev/null
    [[ $(dummy_version) == 1.0.0 ]] || die "$image single-deb: expected 1.0.0"
    echo "ok single-deb"

    use_repo r2
    apt_get update >/dev/null
    apt_get upgrade -y >/dev/null
    [[ $(dummy_version) == 1.1.0 ]] || die "$image upgrade: expected 1.1.0"
    echo "ok upgrade"

    new_container "$image"
    use_repo r1
    apt_get update >/dev/null
    mv "$tmp/www/r1" "$tmp/www/r1.old"
    cp -r "$tmp/www/r2" "$tmp/www/r1"
    apt_get install -y pergament=1.0.0 >/dev/null || die "$image cached-index: install failed"
    [[ $(dummy_version) == 1.0.0 ]] || die "$image cached-index: expected 1.0.0"
    rm -rf "$tmp/www/r1"
    mv "$tmp/www/r1.old" "$tmp/www/r1"
    echo "ok cached-index"

    new_container "$image"
    use_repo bad
    if out=$(apt_get update 2>&1); then
        die "$image wrong-key: apt-get update succeeded"
    fi
    grep -Eq 'NO_PUBKEY|not signed' <<<"$out" || die "$image wrong-key: unexpected output: $out"
    echo "ok wrong-key"
done
echo "all checks passed"
