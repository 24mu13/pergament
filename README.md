# Pergament

A quiet reader for `.jwpub` publications on Linux, with an untested build for
Macs. Today's text, the Bible with a study pane, your library, the weekly
meeting material, and your own notes and highlights, in a flat interface that
keeps out of the way of the text.

Pergament is a desktop app (Tauri with a React frontend), a command line tool
called `pergament`, and the Rust library underneath both. It is unofficial; see
[Before you use it](#before-you-use-it).

![Home with today's daily text](docs/screenshots/01-home-light.png)

| | |
|---|---|
| ![Home in the dark theme](docs/screenshots/01-home-dark.png) | ![The books of a Bible and the go-to button](docs/screenshots/03-bible-books-light.png) |
| ![Lanterns 10 with highlights, a note and the study pane](docs/screenshots/03-bible-study-pane-dark.png) | ![A workbook week with its colored sections](docs/screenshots/06-workbook-highlights-light.png) |
| ![The library's video categories](docs/screenshots/04-library-video-dark.png) | ![Personal Study with notes, tags and filters](docs/screenshots/08-personal-study-light.png) |

Every view is in [docs/screenshots](docs/screenshots), in both themes. The
pictures show invented content only: made-up publications, Bible text, covers,
notes and highlights. None of it comes from a real publication.

## What you can do with it

**Read.** Home shows today's date and theme scripture once the daily text
booklet is downloaded, with arrows to the previous and next day. The Bible has
the publication's own tabs, book tiles and a chapter grid. In the reader, the
arrow keys turn to the previous and next chapter or day. `Ctrl+G` (or the
button in a Bible's top bar) opens a box where `Heb 10:24` takes you straight
to the verse; a name only has to start the book's name.

**Study.** The reader has a study pane with the outline, footnotes, cross
references and study notes of each verse. A Bible link opens Parallel
Translations in a side pane, with the cited verses in every Bible of your
library; "Customize" chooses which and in what order. Other links show the
reference with the cited paragraphs tinted, and the pane offers to download a
publication you don't have; when the file quotes the cited passage itself, the
pane first shows that embedded excerpt, with the download behind its title
bar. Large pictures in a page are scaled to fit, and a click opens one at full
size with zoom and its caption.

**Keep notes.** Select text to highlight it in one of six colors or attach a
note; click a highlight to change or remove it. Answer fields in workbooks and
study articles are text boxes whose content stays on this computer. Personal
Study lists your notes with their tags and your bookmarks, and lets you search
them, filter by highlight color, and sort by date or publication.

**Meetings.** The selected week's workbook program and Watchtower study
article, from downloaded issues, with links to download the rest. The three
workbook sections have their own colors and icons.

**Library.** The catalog's categories are split the way JW Library does it:
newer and older publications, yearbooks, editions, Watchtower and Awake! by
year. Downloaded publications are grouped by the type in their manifest, so
types the catalog doesn't list, such as Curriculum and Outlines, show up once
you import one. The three dots on a tile share a jw.org link, add it to your
favorites (also when it isn't downloaded), offer it in other languages, and
remove a downloaded publication.

**Watch and listen.** The public video and audio categories are in the
Library. A click streams the recording in a player next to the sidebar, with
quality (automatic unless you pick one), speed, repeat and subtitles, and it
can shrink to a bar while you keep reading. The cloud button downloads a
quality you choose; downloads are verified and listed under Downloaded.
Recordings that publications link to open in the same player.

**Stay up to date.** A Library tab lists downloaded publications that have a
newer version, with "Update all". Updating replaces the old version, and your
highlights, notes and bookmarks are kept because they are stored apart from the
publications. At startup the app compares your publications with the catalog,
but only if you have loaded it before and at most once a day; Settings can turn
it off.

**Back up.** Backups are `.jwlibrary` files, the same format JW Library uses, so
a backup from a phone can be restored here and the other way round. Restoring
replaces the current data; the previous database is kept as
`userData.db.before-restore` in the library folder. A backup can also be merged
into the current data instead of replacing it; see the backup setting below.

**Show it on a second screen.** A Settings option opens a black window,
fullscreen on another monitor if there is one, with the year text from the daily
text booklet. Recordings and pictures you open are shown there too, without
controls, and the player here becomes the remote control. Wayland compositors
decide where a window appears; if it opens on the wrong screen, move it and
press F for fullscreen.

### Settings

- **Interface language:** English or German, following the system language by
  default. To add one, see [docs/TRANSLATING.md](docs/TRANSLATING.md). The
  language of the publications is a separate choice, in the menu at the top
  right.
- **Appearance:** light, dark or follow the system. Both avoid pure black and
  pure white.
- **Content width:** a centered column, which is easier to read, or the whole
  window. The reader follows it too.
- **Reading font:** the system font, or "Easy to read", which uses Atkinson
  Hyperlegible Next everywhere, the Bible text included.
- **Text size**, **updates at startup**, **second display** and **backup**.
  "Merge backups instead of replacing" (Settings > Library & data) combines a
  backup with your data and keeps the newer version of each item. Merging
  never deletes: an item deleted on one side comes back from the other.
- **Cache:** shows how much space the catalog, covers and unfinished downloads
  use, and clears it. Downloaded publications and your notes stay.

### Keyboard and screen readers

Focus is always visible, menus work with the arrow keys and give focus back when
they close, the go-to box keeps focus inside it, there is a "Skip to content"
link, icon buttons have labels, and animation stops when the system asks for
reduced motion. It has not been tested with a screen reader yet; reports are
welcome.

### Where the data comes from

Home lists, categories and meetings come from jw.org's public catalog, about
58 MB. It is downloaded only when you ask for it and checked for updates at most
once a day. Cover images are fetched once and cached.

## Install

Pergament is released as packages for Linux, a zip for Linux and a disk image
for Macs with Apple Silicon, or you build it from source.

**From packages.** Each release has four packages for x86_64 Linux, each with a
`.sha256` file to check first:

```sh
sha256sum -c Pergament-X.Y.Z-linux-x86_64.deb.sha256
sudo apt install ./Pergament-X.Y.Z-linux-x86_64.deb        # Debian, Ubuntu, Mint
sudo dnf install ./Pergament-X.Y.Z-linux-x86_64.rpm         # Fedora
chmod +x Pergament-X.Y.Z-linux-x86_64.AppImage && ./Pergament-X.Y.Z-linux-x86_64.AppImage
flatpak install --user Pergament-X.Y.Z-linux-x86_64.flatpak
```

The .deb and .rpm pull in what the app needs, including the H.264 video
decoder, and install both `pergament-app` and the `pergament` command line
tool. The AppImage runs as it is; on a distribution without FUSE, start it
with `--appimage-extract-and-run`. The flatpak keeps its data (your library,
notes and settings) in `~/.var/app/io.github.v3rm1n.pergament/data/pergament`,
apart from a native install, and the command line tool is
`flatpak run --command=pergament io.github.v3rm1n.pergament`.

**From the release zip.** Download `pergament-X.Y.Z-linux-x86_64.zip` and its
`.sha256` file from the [releases page](https://github.com/v3rm1n0/pergament/releases),
then:

```sh
sha256sum -c pergament-X.Y.Z-linux-x86_64.zip.sha256
unzip pergament-X.Y.Z-linux-x86_64.zip
cd pergament-X.Y.Z-linux-x86_64
./install.sh                    # --prefix DIR, --dry-run and --uninstall also work
```

The installer copies `pergament-app` and `pergament` to `~/.local/bin`, adds the
icons and a desktop entry so Pergament shows up in your application menu, and
checks that the libraries it needs (WebKitGTK 4.1, GTK 3, libsoup 3, OpenSSL,
SQLite) are installed. The zip is built on Ubuntu 22.04, so it needs a
distribution at least that recent.

The packages include the H.264 decoder, so video playback works out of the box:
the .deb depends on and the .rpm recommends `gst-libav` (`gstreamer1-libav`
on Fedora), the
AppImage bundles GStreamer, and the flatpak runtime has it. Only from the zip,
or after building from source, do you need to install it yourself
(`gst-libav` on Debian and Ubuntu, `gstreamer1-libav` on Fedora, `gst-libav`
on Arch). Without it the player offers to open the recording in your browser
instead.

**On a Mac with Apple Silicon.** Each release also has a disk image,
`Pergament-X.Y.Z-macos-arm64.dmg`, with the desktop app only (no command line
tool) and its `.sha256` file. Check it with `shasum -a 256 -c`, open the image
and drag Pergament to Applications. The app is not signed with an Apple
Developer ID and not notarized, so macOS blocks the first start: right-click
the app and choose Open, or allow it in System Settings under Privacy &
Security. The maintainer has not been able to test it on a Mac, so expect
rough edges. Intel Macs have no build, and building from source there is
untested too.

**With Nix** (flakes enabled), straight from GitHub:

```sh
nix profile install github:v3rm1n0/pergament   # installs pergament-app and pergament
nix run github:v3rm1n0/pergament               # or just try the app once
```

**With the install script**, which uses Nix if you have it and otherwise builds
with cargo and bun and installs below `~/.local`:

```sh
git clone https://github.com/v3rm1n0/pergament.git
cd pergament
scripts/install.sh              # --prefix DIR, --no-nix, --dry-run and --uninstall also work
```

Without Nix it needs cargo, bun, pkg-config and the development files for
WebKitGTK 4.1, GTK 3, libsoup 3, OpenSSL and SQLite; the script lists what is
missing for Debian, Fedora and Arch. It also runs straight from the web
(`curl -fsSL https://raw.githubusercontent.com/v3rm1n0/pergament/main/scripts/install.sh | bash`).

> **Always check scripts you copy from the internet.** Piping a download into
> `bash` runs whatever it contains, with your permissions. Read
> [scripts/install.sh](scripts/install.sh) first, or clone the repository and
> run it from the checkout. It builds from source and only writes below the
> prefix (`~/.local` by default) or into your Nix profile; `--dry-run` prints
> every step without doing it.

**Linux details.** The app sets two environment variables unless you have set
them: `WEBKIT_DISABLE_DMABUF_RENDERER=1`, because WebKitGTK draws garbage on some
GPUs without it, and `GST_PLUGIN_FEATURE_RANK`, so GStreamer does not pick
NVIDIA's hardware video decoders, which take the page down on NVIDIA under
Wayland. Software decoding handles these videos fine.

## Command line

```sh
pergament import nwtsty_X.jwpub wp_X_202609.jwpub   # verify and add to the library
pergament list                                      # show imported publications
pergament show nwtsty                               # list books and documents
pergament show nwtsty 19:23 > psalm23.html          # Bible chapter (book:chapter)
pergament show wp26 3 > article.html                # document by DocumentId
pergament search X wachtturm                        # search the catalog (X = German)
pergament download wp --lang X --issue 20260900     # download, verify, import
pergament download nwtsty --lang X                  # undated works need no issue
```

- `show` writes a complete HTML page with light and dark styles, with images
  pointing into the library. `--fragment` prints only the content.
- Language codes are mapped to MEPS ids through the catalog; for a language that
  can't be mapped, pass `--meps-id`.
- Downloads resume after an interruption. They are checked against the MD5 from
  the download API and, when the catalog is cached, against its size and SHA-1,
  and then go through the normal import. Requests carry a `pergament/…`
  User-Agent, are at least one second apart and are retried with backoff on
  network errors, 429 and 5xx.
- The library lives in `$XDG_DATA_HOME/pergament` (usually
  `~/.local/share/pergament`); `--library DIR` or `PERGAMENT_LIBRARY` changes it.
  The catalog and partial downloads go to `$XDG_CACHE_HOME/pergament` (`--cache
  DIR` or `PERGAMENT_CACHE`). A folder from before the rename, `jwlinux`, is
  moved to the new name on first start. Importing a publication again replaces
  the existing copy.

## Before you use it

This project is not affiliated with, endorsed by or supported by Jehovah's
Witnesses or the Watch Tower Bible and Tract Society. "JW Library" and related
names are their trademarks. The layout follows the official app on other
platforms; the name, colors and icons are Pergament's own.

- **Your own publications.** It is meant for reading publications you have
  obtained yourself, on your own computer. The repository contains no
  publications; you import or download them at runtime. Test files are read from
  paths you supply and are never committed.
- **Clean-room format.** Nothing was decompiled or taken from the official app.
  The file format was worked out from public open-source projects and from
  inspecting `.jwpub` files and one user data backup. Every detail and where it
  came from is in [docs/FORMAT.md](docs/FORMAT.md).
- **Encryption.** Publication text inside `.jwpub` files is encrypted, and
  Pergament decrypts it so you can read it. Depending on where you live,
  distributing software that does this may be restricted. Read the
  [license notes](#license) before you use or share it.
- **Free and non-commercial**, and it will stay that way. It only downloads
  files that jw.org offers for download, such as `.jwpub` publications and MP3
  and MP4 recordings, from the same public services the site uses. It does not
  scrape pages, and it is not meant for commercial use.
- **No telemetry.** The only network traffic goes to jw.org's public catalog and
  download services, and only when you search, download or play a recording, or
  when the startup check for updates refreshes a catalog you have loaded before.
  The fonts are part of the app and are never loaded from a server.
- **Untrusted input.** Imported files are treated as untrusted: hashes are
  verified, archives are unpacked with path and size checks, and rendered HTML is
  sanitized.

## Contributing

Pull requests are welcome, and so are translations. How to run it from source,
the checks, how the screenshots are taken, and how releases are made are in
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

This project is free software under the GNU General Public License, version 3
only. The full text is in [LICENSE](LICENSE). The notes below describe how the
project is published and what you should know before using it. They do not add
restrictions to the GPL.

**Fonts.** The "Easy to read" setting uses Atkinson Hyperlegible Next and the Bible
text uses Noto Serif. Both are
shipped with the app (`ui/src/fonts`) under the SIL Open Font License 1.1. The
license text is next to the files.

**Tolerated, not authorised.** The project has no permission from the Watch
Tower Bible and Tract Society or any other rights holder of the publications it
reads. At most, its existence and use are tolerated. That can change at any
time, and the project may then be changed or withdrawn without notice.

**Use at your own risk.** You use this software entirely at your own risk. As
sections 15 and 16 of the GPL state, it comes without any warranty, and the
authors are not liable for any damage or loss, including lost data and any legal
consequences of using it. You are responsible for checking that your use is
lawful where you live, in particular decrypting `.jwpub` files and downloading
from jw.org.

**Official builds.** Each release on GitHub has an AppImage, a .deb, a .rpm and
a .flatpak for x86_64 Linux, a zip for Linux with the compiled binaries, the
icons and an install script, a disk image for Apple Silicon Macs, `.sha256`
files to check them, and the source code. These are the only official builds;
there are no repositories for apt, dnf or a flatpak remote. You can also build
it yourself as described under [Install](#install). Compiled versions from
anyone else do not come from this project and are not supported.
