# Polaris Audio

**A fast, private Windows music player for local and network libraries.**

Polaris plays music directly from your computer, mapped drives, and NAS shares. Browse large collections, build playlists, follow lyrics, discover more about your artists, and generate a Supermix shaped by your listening without uploading your audio.

[Download the latest release for Windows](https://github.com/Rhigo/Polaris-Audio/releases/latest)

![Polaris artist view](docs/screenshots/artist.png)

## Install Polaris

The latest release includes two Windows builds:

| Download | Best for |
| --- | --- |
| `Polaris-1.0.12-Setup.exe` | Normal use. Installs Polaris and creates stable Start Menu and desktop shortcuts. |
| `Polaris-1.0.12-Portable.exe` | Running without installation or from removable storage. |

Use the setup build if you want to pin Polaris to the taskbar. The portable build extracts to a temporary directory while it runs, so Windows cannot keep a stable pinned shortcut for it.

Polaris is currently built and released for Windows.

## Add Your Music

1. Open Polaris and select **Add music source**.
2. Choose a local folder, mapped network drive, or UNC network share.
3. Add any other folders from **Settings > Music sources**.
4. Keep Polaris open while the first library scan completes.

Polaris reads folders recursively and combines every source into one library. Later scans reuse unchanged metadata, while changes to audio files and matching `.lrc` files are refreshed automatically in the background. A manual refresh is available in Settings.

For the best browsing experience, populate the artist, album, album artist, genre, year, disc, and track tags in your audio files. When tags are missing, Polaris uses the filename as the title and groups the track under **Unknown Artist** or **Unknown Album**.

### Recognized audio formats

- FLAC (`.flac`)
- MP3 (`.mp3`)
- AAC and ALAC (`.aac`, `.m4a`)
- Ogg Vorbis and Opus (`.ogg`, `.opus`)
- WAV (`.wav`)
- Windows Media Audio (`.wma`)
- Monkey's Audio (`.ape`)

Polaris scans and extracts metadata from these file types. Playback ultimately depends on the codec support included with Electron.

## Connect Jellyfin

Polaris can combine music from one or more Jellyfin servers with your local and NAS sources. Synced Jellyfin songs appear in the same Artists, Albums, Songs, Genres, Decades, search, playlists, and Supermix views as local music.

1. Open **Settings > Jellyfin servers**.
2. Enter the complete server URL. Public domains such as `music.example.com` default to HTTPS; local addresses should include their protocol and port, such as `http://192.168.1.20:8096`.
3. Enter your Jellyfin username and password, then select **Connect**.
4. Wait for the music metadata to sync. Use the refresh button beside the server whenever you want to update it.

Include any configured Jellyfin base path in the address, for example `https://example.com/jellyfin`. To listen away from home, the Jellyfin server must already allow remote access for your account and be reachable from the internet. Jellyfin recommends a trusted HTTPS certificate and reverse proxy; exposing the default HTTP port directly to the internet is not recommended.

Polaris sends the password only to the selected Jellyfin server during sign-in and never saves it. The returned access token is encrypted using Windows credential protection and is used only by the Electron main process. Disconnecting a server removes its token and cached tracks from Polaris without deleting anything from Jellyfin.

## Explore Your Library

Use the sidebar to open:

- **Home** for an overview of your collection and recent listening.
- **Supermix** for up to 100 tracks selected from your history, favorites, ratings, artists, and genres.
- **Recently played** for your latest listening history.
- **Artists**, **Albums**, and **Songs** for sortable collection views.
- **Genres** and **Decades** for views generated from your file tags.
- **Loved songs** for tracks marked with the heart button.
- **Playlists** for your own saved collections.

Search matches songs, albums, and artists. Large result sets are rendered in batches to keep navigation responsive; Polaris includes a performance test built around a synthetic 20,000-track collection.

![Polaris genre browser](docs/screenshots/genres.png)

## Play Music

Select a song to start playback from the current list. The player includes:

- Play, pause, previous, and next controls.
- Shuffle and repeat-off, repeat-all, and repeat-one modes.
- Seek and volume controls.
- A visible play queue.
- Favorite, thumbs-up, and thumbs-down actions.
- Album artwork and Windows media-session information.
- Spectrum, waveform, and ambient visualizer styles.

Open the expanded player for artwork, lyrics, queue controls, and the visualizer in one view. The layout adapts to narrow windows while retaining the same playback controls.

![Polaris expanded player](docs/screenshots/player-desktop.png)

![Polaris lyrics player in a narrow window](docs/screenshots/player-mobile.png)

### Lyrics

Polaris looks for lyrics in this order:

1. A `.lrc` file beside the song with the same filename.
2. Lyrics embedded in the audio file's metadata.
3. LRCLIB, when **Online lyrics** is enabled in Settings.

Timestamped lyrics follow playback and can be selected to seek within the song. Plain lyrics can scroll automatically based on playback progress; use the **Auto-scroll** switch above the lyrics to change that behavior. The preference is remembered.

### Playlists and ratings

Create a playlist from the sidebar, then use a song's menu to add it. Within a playlist you can rename or delete the playlist, remove songs, and drag songs into a new order.

The heart, thumbs-up, and thumbs-down controls are separate signals. Loved songs appear in their own library view, while all three signals help shape Supermix. Disliked songs are excluded from Supermix.

## Artist Pages

Artist pages combine your locally owned music with optional public information:

- Biography, genres, and artist imagery.
- Public artist and social links.
- A popularity-ranked top ten containing only songs in your library.
- Albums and songs grouped under the selected artist.

If an online service is unavailable, normal library browsing and playback continue to work. Missing results are cached briefly to avoid repeated requests.

## Personalize Polaris

Settings include:

- Music source management and manual library refresh.
- Jellyfin server connection, refresh, and disconnect controls.
- Online lyric lookup.
- Plain-lyric auto-scroll and lyric contrast.
- Visualizer style, intensity, opacity, and color.
- Dynamic player backgrounds.
- Reduced motion.
- Sidebar expansion and accent-color presets.
- Update checks and release information.

Playback state such as volume, shuffle, and repeat mode is restored between sessions.

## Privacy and Network Access

Local audio stays on your computer or network storage. Polaris streams local files directly from the folders you select and does not upload them. When you connect Jellyfin, audio and artwork are requested directly from that server through an authenticated main-process proxy.

Some enrichment features make internet requests using only the artist, album, song title, duration, or application version needed for the request:

| Service | Purpose |
| --- | --- |
| [LRCLIB](https://lrclib.net/) | Lyrics when local and embedded lyrics are unavailable |
| [TheAudioDB](https://www.theaudiodb.com/) | Artist biographies and imagery |
| [MusicBrainz](https://musicbrainz.org/) | Artist identity and public links |
| [ListenBrainz](https://listenbrainz.org/) | Public recording popularity, filtered to music you own |
| [Deezer](https://www.deezer.com/) | Fallback public artist-track ranking |
| [Apple Music](https://music.apple.com/) | Final artist-catalog fallback |
| Wikimedia | Fallback artist imagery |
| GitHub | Checks for newer Polaris releases |
| Your Jellyfin server | Authentication, music metadata, artwork, and audio streaming when you add it |

Online lyrics can be disabled in Settings. Other artist enrichment is loaded only when relevant artist views are opened. Results are cached locally, and MusicBrainz requests are serialized and rate-limited.

## Updates

Polaris checks the latest GitHub Release at startup and when you select **Check for updates** in Settings. If an update is available, Polaris opens the setup download when one exists, otherwise it opens the portable download or release page.

Updates are not installed silently and Polaris never replaces the executable that is currently running.

## Data and Removal

Polaris stores its library index and preferences in `%APPDATA%\Polaris`:

| Item | Contents |
| --- | --- |
| `library.json` | Music sources, indexed tracks, history, favorites, ratings, playlists, and settings |
| `artist-images.json` | Cached artist details, imagery, links, and rankings |
| `online-lyrics.json` | Cached online lyrics and lookup results |
| `jellyfin-credentials.json` | Device identifiers and access tokens encrypted by Electron secure storage |
| `artwork\` | Artwork extracted from your audio-file metadata |

The index points to your music files; it does not copy the audio into the application-data folder.

To remove an installed copy, uninstall Polaris from Windows Settings. To remove a portable copy, close Polaris and delete its executable. Delete `%APPDATA%\Polaris` only if you also want to erase the library index, playlists, history, settings, and caches.

## Troubleshooting

**A network source is temporarily unavailable**  
Reconnect the drive or NAS and refresh the library. Polaris preserves indexed tracks under an unavailable source during a scan so that a temporary outage does not erase your saved library state.

**A new or changed song does not appear**  
Wait for the background refresh or use the manual refresh in Settings. Confirm that the file uses a supported extension and that Polaris can read its folder.

**Artwork, lyrics, or artist information is missing**  
Check the file's embedded tags and artwork. For sidecar lyrics, use the song's exact filename with the `.lrc` extension. Online enrichment requires an internet connection and may have no result for some releases or artists.

**A format is indexed but does not play**  
Playback uses Electron's Windows media support. Re-encoding unusual files to FLAC, MP3, AAC, or Opus can resolve codec-specific failures.

**A Jellyfin server will not connect**
Open the same URL in a browser on this computer first. Include `http://` and port `8096` for a typical local server, or use a trusted `https://` URL for remote access. Include the complete base path when the server uses one. Confirm that the account is allowed to connect remotely in Jellyfin.

**Jellyfin playback stops away from home**
Confirm that the public URL remains reachable and that its HTTPS certificate is valid. Polaris streams the original file through its authenticated proxy, so playback depends on the codec support included with Electron.

For reproducible problems, [open a GitHub issue](https://github.com/Rhigo/Polaris-Audio/issues) with the Polaris version, Windows version, audio format, and steps needed to reproduce it. Please do not attach copyrighted audio; a short generated test file or metadata description is enough.

Security issues should be reported according to [SECURITY.md](SECURITY.md).

## What's New in 1.0.12

- Added automatic retries when Jellyfin briefly pauses or returns a temporary server error.
- Made large-library sync resilient to intermittent failures on individual pages.
- Added clearer errors for server identification and sign-in timeouts.

See [CHANGELOG.md](CHANGELOG.md) for the complete release history.

## For Contributors

Polaris is an Electron application with a React and TypeScript interface. The Electron main process owns filesystem access, metadata extraction, library scanning, media streaming, caching, and internet requests. A context-isolated preload bridge exposes a small IPC API to the renderer; Node.js integration is disabled in the UI.

### Requirements

- Windows
- Node.js 22 or later
- npm

### Run locally

```powershell
npm install
npm run dev
```

Additional commands:

| Command | Purpose |
| --- | --- |
| `npm run dev:web` | Run only the Vite frontend development server |
| `npm run lint` | Lint the React, Electron, and Vite source |
| `npm run build` | Type-check and create the production web bundle |
| `npm run test:smoke` | Exercise the packaged-style Electron workflows with Playwright |
| `npm run test:performance` | Test Songs and search with a synthetic 20,000-track library |
| `npm run dist` | Build the Windows setup and portable executables |
| `npm run preview` | Preview the production web bundle with Vite |

The smoke suite covers scanning, local and Jellyfin streaming, secure remote authentication, lyrics, discovery, artist services, playlists, feedback, settings, updates, and desktop and narrow-window layouts.

### Project structure

| Path | Responsibility |
| --- | --- |
| `src/App.tsx` | React views, playback state, search, playlists, Supermix, lyrics, and settings UI |
| `src/App.css` and `src/index.css` | Responsive application and global styles |
| `src/types.ts` | Shared renderer-side data contracts |
| `electron/main.js` | Window lifecycle, scanning, metadata, persistence, local and Jellyfin streaming, updates, and online services |
| `electron/preload.cjs` | Context-isolated renderer API |
| `tests/electron-smoke.mjs` | End-to-end Electron behavior checks |
| `tests/performance-smoke.mjs` | Large-library performance checks |
| `build-resources/` | Windows packaging resources |

## License

Polaris is open source under the [MIT License](LICENSE).
