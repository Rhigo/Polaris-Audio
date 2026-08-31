# Changelog

## 1.0.6 - 2026-08-31

- Fixed playlist drag-and-drop ordering and persisted rapid playlist changes against the latest state.
- Added automatic progress-based scrolling for lyrics that do not include synchronized timestamps.
- Added a standard Windows installer with stable Start Menu and taskbar shortcuts, consistent app identity, and single-instance focusing.
- Removed invalid placeholder artist links that could resolve to the local computer.
- Preferred the installed build when downloading future updates while retaining the portable option.

## 1.0.5 - 2026-08-30

- Ranked artist-page songs using explicit global popularity data, with public fallbacks that do not require personal credentials.
- Improved matching for remastered, explicit, featured, live, and other title variants.
- Kept artist top tens limited to locally owned music while filling open positions with local fallback tracks.
- Refreshed stale artist caches so corrected rankings appear immediately after updating.

## 1.0.4 - 2026-08-30

- Added multiple simultaneous local, mapped-drive, and NAS music sources with automatic migration from the original single-folder library.
- Made filesystem-triggered refreshes silent, increased their debounce, and reduced the NAS fallback poll from five to thirty minutes.
- Added source management to Settings and authorized playback safely across every configured root.
- Improved spacing and hierarchy between artist banners and biographies.
- Open-sourced Polaris under the MIT License and added security, signing, and reproducible GitHub build documentation.

## 1.0.3 - 2026-08-30

- Redesigned Settings with release information, changelog details, repository access, and update checks.
- Stabilized Supermix so tracks no longer move or disappear when playback updates listening history.
- Added Rhigo Windows publisher metadata and certificate-ready packaging.

## 1.0.2 - 2026-08-30

- Added GitHub release update checks at startup and in Settings with verified portable download links.
- Kept portable updates safe by downloading the new executable instead of replacing the running app.

## 1.0.1 - 2026-08-30

- Improved playback lifecycle handling, skip responsiveness, volume updates, and visualizer performance.
- Strengthened custom media streaming and recovery for NAS interruptions.
- Added large-library indexing, sorting, discovery, playlists, ratings, Supermix, rich artist data, and online lyrics fallback.

## 1.0.0 - 2026-08-30

- Initial public portable Windows release of Polaris.
