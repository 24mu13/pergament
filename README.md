# Pergament

A quiet reader for `.jwpub` publications on Linux. It has today's text, the
Bible with a study pane, your library, the meeting material, and your notes and
highlights. There is also an untested build for Apple Silicon Macs.

Pergament is unofficial. Read [Before you use it](#before-you-use-it) first.

![Home with today's text, favorites and the Teaching Toolbox](docs/screenshots/01-home-light.png)

| | |
|---|---|
| ![A Bible chapter with highlights and the study pane](docs/screenshots/03-bible-study-pane-dark.png) | ![Personal Study with notes, tags and filters](docs/screenshots/08-personal-study-light.png) |

More in [docs/screenshots](docs/screenshots). All content shown is invented.

## Features

- **Home:** today's text, favorites, the Teaching Toolbox and What's New. The
  last two each have their own language.
- **Bible:** book tiles, chapter grid and book overviews. `Ctrl+G` goes to a
  reference such as `Heb 10:24`, and the arrow keys turn chapters. The study
  pane has the outline, footnotes, cross references, study notes and Research
  Guide. Bible links open the verses in all your translations side by side.
- **Library:** the catalog's publications, video and audio, what you have
  downloaded, and updates. Recordings play in a built-in player with quality,
  speed and subtitles.
- **Meetings:** the week's workbook program and Watchtower study article.
- **Personal Study:** highlights in six colors, Markdown notes with tags, and
  bookmarks, all searchable. Notes can move to their own window. There,
  `Ctrl+L` links a Bible reference and `Ctrl+P` also opens it.
- **Backups:** `.jwlibrary` files, the same format JW Library uses. Restore
  one, or merge it with your data.
- **Settings:** English, German or Portuguese (Brazil); light or dark; a
  centered or full-width layout; an easy-to-read font; and a second display for
  the year text, recordings and pictures.

## Install

Releases are on the [releases page](https://github.com/v3rm1n0/pergament/releases).
Check every download against its `.sha256` file before installing it.

**Linux packages** (x86_64):

```sh
sudo apt install ./Pergament-X.Y.Z-linux-x86_64.deb    # Debian, Ubuntu
sudo dnf install ./Pergament-X.Y.Z-linux-x86_64.rpm     # Fedora
./Pergament-X.Y.Z-linux-x86_64.AppImage
flatpak install --user Pergament-X.Y.Z-linux-x86_64.flatpak
```

**Linux zip:** unpack it and run `./install.sh`. It needs WebKitGTK 4.1, GTK 3,
libsoup 3, OpenSSL and SQLite. Video needs `gst-libav` (`gstreamer1-libav` on
Fedora); the packages above already include it.

**Mac (Apple Silicon):** open the `.dmg` and drag Pergament to Applications.
The app isn't signed, so the first time, right-click it and choose Open.

**Nix:** `nix profile install github:v3rm1n0/pergament`

**From source:** clone the repository and run `scripts/install.sh`. It uses Nix
if you have it, and otherwise builds with cargo and bun. Run it with
`--dry-run` to see what it would do.

## Command line

```sh
pergament import file.jwpub                       # add to the library
pergament list                                    # imported publications
pergament show nwtsty 19:23 > psalm23.html        # a Bible chapter as HTML
pergament search X wachtturm                      # search the catalog
pergament download wp --lang X --issue 20260900   # download and import
```

The library is in `~/.local/share/pergament`. You can change it with
`--library` or `PERGAMENT_LIBRARY`.

## Before you use it

Pergament is not affiliated with or endorsed by Jehovah's Witnesses or the
Watch Tower Bible and Tract Society. "JW Library" is their trademark.

- **Your own publications only.** The repository contains none.
- **Clean-room.** Nothing was decompiled. The file format is documented in
  [docs/FORMAT.md](docs/FORMAT.md).
- **Encryption.** Pergament decrypts the text in `.jwpub` files. Depending on
  where you live, sharing software that does this may be restricted.
- **Free, non-commercial, no telemetry.** It only connects to jw.org's public
  catalog and download services, and only when you ask it to.

## Contributing

Pull requests and translations are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md)
and [docs/TRANSLATING.md](docs/TRANSLATING.md).

## License

GPL-3.0-only, see [LICENSE](LICENSE). The fonts are under the SIL Open Font
License 1.1.

The project has no permission from the rights holders. Its use is tolerated at
most, which can change at any time. Use it at your own risk: it comes without
warranty, and you are responsible for checking that your use is lawful where
you live. The only official builds are the ones on the GitHub releases page.
