# Changelog

## 1.0.13 - 2026-09-01

- Propagated cancelled custom-protocol responses to upstream Jellyfin requests so abandoned audio and artwork streams close promptly.
- Explicitly released the previous audio source before changing tracks.
- Deferred off-screen artwork loading to avoid opening hundreds of simultaneous image requests.
- Increased metadata page size and loaded up to three pages concurrently to reduce large-library refresh time without flooding the server.
- Added a stress regression that aborts repeated partial Jellyfin streams and verifies every started upstream connection closes before playback and refresh continue.

## 1.0.12 - 2026-09-01

- Added bounded retries with backoff for transient Jellyfin timeouts and retryable HTTP responses.
- Kept authentication rejections immediate while making safe server-identification and library-page requests resilient.
- Added visible retry progress during temporary Jellyfin pauses.
- Added phase-specific connection and sign-in timeout errors with an actionable Connect retry.
- Added end-to-end coverage for recovery from a temporary Jellyfin failure during initial sync.

## 1.0.11 - 2026-09-01

- Added authenticated loading of local lyrics stored with Jellyfin audio items.
- Preferred song-level primary artwork and added album artwork fallback when Jellyfin returns a missing image.
- Included Jellyfin media source IDs in static stream requests so multi-version items play the selected source.
- Added end-to-end regression coverage for remote lyrics, artwork fallback, and media-source-specific playback.

## 1.0.10 - 2026-09-01

- Added visible Jellyfin connection and library-sync progress.
- Added a full-response timeout so stalled metadata bodies return an actionable error.
- Reduced Jellyfin sync page size to improve progress on slower remote servers.
- Preserved authenticated server connections when the initial library sync needs to be retried.
- Switched playback to finite, byte-range-capable Jellyfin streams to prevent memory exhaustion from open-ended transcodes.
- Added compact Jellyfin artwork thumbnails for song lists to keep large remote libraries within stable memory bounds.
- Shared one cached server-access snapshot across remote media requests instead of reparsing the complete library for every cover.

## 1.0.9 - 2026-09-01

- Kept Settings accessible before any music source has been added.
- Added Folder and Jellyfin server choices to the sidebar source button.
- Added first-run actions for both local folders and Jellyfin servers.
- Updated the source summary to count local folders and Jellyfin servers together.

## 1.0.8 - 2026-09-01

- Added Jellyfin music libraries as first-class Polaris sources.
- Added sign-in for local servers and trusted public HTTPS URLs, including installations hosted below a base URL.
- Added paginated Jellyfin library sync, artwork, audio transcoding, refresh, and disconnect controls.
- Protected Jellyfin access tokens with Electron secure storage and kept credentials out of renderer-visible media URLs.
- Added end-to-end Jellyfin authentication, metadata, artwork, playback, refresh, disconnect, and credential-storage coverage.
- Made smoke and performance test commands start their required Vite preview server automatically.
- Stabilized metadata and navigation fixtures used by the Electron smoke suite.

## 1.0.7 - 2026-08-31

- Added a persistent auto-scroll toggle directly above lyrics without timestamps.
- Kept static lyric auto-scroll enabled by default while allowing manual scrolling for songs with long intros.
- Clarified in-app update messaging for installed Windows releases.

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
