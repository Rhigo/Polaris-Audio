# Polaris Audio

**A fast, private Windows music player for large local and NAS libraries.**

Polaris plays your own collection directly from disk. It combines a responsive library, immersive playback, synchronized lyrics, rich artist pages, playlists, and a preference-aware Supermix without uploading your audio.

[Download the latest Polaris release for Windows](https://github.com/Rhigo/Polaris-Audio/releases/latest)

No installer is required. Download the portable `.exe`, open it, and choose your music folder.

![Polaris artist view](docs/screenshots/artist.png)

## Highlights

- **Built for large collections** - tested with 20,000 tracks, bounded rendering, cached metadata, and concurrent scanning.
- **Multiple music sources** - combine local folders, mapped drives, and NAS shares in one library.
- **Quiet incremental updates** - unchanged files reuse indexed tags while file and `.lrc` changes refresh silently in the background.
- **Local-first playback** - FLAC, MP3, AAC/ALAC, OGG, Opus, WAV, WMA, and APE support with byte-range streaming.
- **Library discovery** - browse artists, albums, songs, genres, decades, recent plays, and loved songs.
- **Supermix** - a regenerating mix shaped by listening history, favorites, thumbs-up, thumbs-down, artists, and genres.
- **Persistent playlists** - create, rename, reorder, remove, and drag tracks into playlists.
- **Immersive player** - desktop and mobile layouts with artwork, lyrics, queue, visualizer, shuffle, repeat-all, and repeat-one.
- **Lyrics fallback** - local `.lrc`, embedded lyrics, then cached LRCLIB results.
- **Rich artist context** - biography and imagery from TheAudioDB, links from MusicBrainz, and ListenBrainz popularity intersected strictly with tracks you own.

## Explore Your Library

Genre and decade views are generated from your tags. Every tile opens a real filtered track list, and the Library navigation can collapse when you want more room.

![Polaris genre browser](docs/screenshots/genres.png)

## Focused Playback

The expanded player keeps transport, feedback, playlist actions, lyrics, queue, and visualizer controls close without hiding the music. Dynamic artwork rendering avoids expensive full-screen blur effects, and lyric lookup uses a binary search as playback advances.

![Polaris expanded player](docs/screenshots/player-desktop.png)

The same experience adapts to narrow screens while preserving the draggable Windows title bar and readable lyrics.

<img src="docs/screenshots/player-mobile.png" alt="Polaris mobile lyrics player" width="390">

## Privacy

Your audio stays on your computer or NAS. Polaris stores its library index, settings, history, playlists, feedback, lyric cache, and extracted artwork in Electron's per-user application data directory.

Online requests contain only the metadata needed for the selected feature:

| Service | Used for |
| --- | --- |
| [LRCLIB](https://lrclib.net/) | Lyrics when local and embedded lyrics are unavailable |
| [TheAudioDB](https://www.theaudiodb.com/) | Artist biographies and imagery |
| [MusicBrainz](https://musicbrainz.org/) | Canonical artist identity and public links |
| [ListenBrainz](https://listenbrainz.org/) | Global recording rank, filtered to local tracks |
| Wikimedia | Artist image fallback |

Online results and misses are cached. MusicBrainz requests are serialized and rate-limited with a descriptive user agent.

## Getting Started

1. Download or build `Polaris-1.0.4-Portable.exe`.
2. Open Polaris and select **Add music source**.
3. Choose a local folder, mapped network drive, or UNC share. Add more sources from Settings at any time.
4. Leave Polaris open for the initial metadata scan. Later refreshes process only changed files.

Polaris checks the repository's latest GitHub Release when it starts and on demand from Settings. When an update is available, it opens the verified portable executable download; it does not modify the currently running file.

For the best browsing experience, keep artist, album, genre, year, disc, and track tags populated. Place synchronized lyrics beside a song using the same filename and an `.lrc` extension.

## Removing Polaris

Close Polaris and delete the portable executable. To also remove its library index, settings, artwork, and online metadata caches, delete `%APPDATA%\Polaris`.

## Development

Requirements: Windows, Node.js 22 or later, and npm.

```powershell
npm install
npm run dev
```

Useful checks:

```powershell
npm run lint
npm run build
npm run test:smoke
npm run test:performance
```

The smoke suite launches real Electron and exercises streaming, playback, lyrics, discovery, artist APIs, playlists, feedback, settings, and desktop/mobile player layouts. The performance suite measures Songs and search with a synthetic 20,000-track library.

Build the portable Windows application:

```powershell
npm run dist
```

The configured builder writes `Polaris-1.0.4-Portable.exe` to the local release output directory.

### Windows code signing

Release builds carry Rhigo publisher metadata and automatically use an Authenticode certificate when electron-builder finds `CSC_LINK` and `CSC_KEY_PASSWORD`. `CSC_LINK` may point to a local `.pfx` file or contain its base64 value. Keep the certificate and password outside the repository.

A trusted OV or EV code-signing certificate issued to Rhigo is required to establish SmartScreen reputation. Publisher metadata or a self-signed certificate alone cannot prevent Windows warnings.

Qualifying open-source releases can instead use the free SignPath Foundation workflow documented in [SIGNING.md](SIGNING.md).

## Release History

See [CHANGELOG.md](CHANGELOG.md) for the cumulative release history.

## Stack

Electron 44, React 19, TypeScript 6, Vite 8, `music-metadata`, Lucide, and Playwright.

## License

Polaris is open source under the [MIT License](LICENSE).
