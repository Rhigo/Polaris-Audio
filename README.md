# Polaris

Polaris is a private, portable desktop music player for large local and NAS libraries. It reads music directly from the selected folder; tracks are never uploaded.

## Use

1. Run `release/Polaris-1.0.0-Portable.exe`.
2. Select **Add music folder** and choose a local folder, mapped network drive, or UNC share.
3. Leave the app open during the first scan. Later rescans reuse cached metadata and are much faster.

Polaris reads embedded tags and artwork from FLAC, MP3, AAC/ALAC, OGG, Opus, WAV, WMA, and APE files. Lyrics are loaded from an `.lrc` file with the same base name as its track or from embedded tags. When neither is available, Polaris requests timed or plain lyrics from LRCLIB's free API. Online results and misses are cached locally; audio files are never uploaded.

The library index, listening history, favorites, and extracted artwork are stored in Electron's per-user application data folder. Artist portraits and fan art are requested from TheAudioDB's free API, with Wikimedia as a fallback; music playback and metadata indexing remain local.

## Development

```powershell
npm install
npm run dev
```

Build the portable Windows app:

```powershell
npm run dist
```

The portable executable is written to `release/Polaris-1.0.0-Portable.exe`.
