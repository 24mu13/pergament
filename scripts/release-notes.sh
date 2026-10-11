#!/usr/bin/env bash
# Text that goes in front of the release notes GitHub generates (see
# .github/release.yml and the release workflow): how to install the downloads.
set -euo pipefail

echo 'Download the zip for Linux, unpack it and run `./install.sh`. It installs the binaries and a desktop entry below `~/.local`. Check the download against the `.sha256` file with `sha256sum -c`. The README also describes building from source.'
echo
echo 'The `.dmg` is a build for Macs with Apple Silicon. It is not signed with an Apple Developer ID and not notarized, so macOS blocks the first start: right-click the app and choose Open, or allow it in System Settings under Privacy & Security. Check the download with `shasum -a 256 -c`. It has not been tested by the maintainer on a Mac.'
