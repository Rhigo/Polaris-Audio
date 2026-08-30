# Polaris To-Do

## Tomorrow's Priorities

- [x] Build **Supermix** from favorites and listening habits.
  - Generate a queue of similar songs using favorite artists, albums, genres, and play history.
  - Keep the mix varied and avoid repeating recently played tracks too often.
  - Allow the mix to be regenerated and started from its own navigation entry.

- [x] Add user-created playlists to the left sidebar.
  - Create, rename, and delete playlists.
  - Drag songs into playlists.
  - Reorder and remove playlist tracks.
  - Persist playlists between app launches.

- [x] Fix the mobile now-playing song title alignment.
  - Keep the title and metadata visually centered/aligned instead of shifted right.
  - Check short, long, and multiline titles on narrow screens.

- [x] Verify and strengthen online lyrics fallback.
  - Keep local `.lrc` and embedded lyrics as the first choices.
  - Use the existing LRCLIB integration when local lyrics are unavailable.
  - Check caching, missing results, rate limits, timeouts, and retry behavior.
  - Clearly disable or label lyrics only after all available sources fail.

- [x] Correct the heart icon position in the expanded player.
  - Align it consistently with the track metadata and other player actions on desktop and mobile.

- [x] Improve lyric readability over dynamic backgrounds.
  - Add adaptive contrast using a scrim, shadow, blur, or dynamically selected text treatment.
  - Verify readability against very light, dark, and similarly colored artwork.

- [x] Fix the lyrics end-of-scroll layout shift.

- [x] Accelerate initial NAS library scans.
  - Read directory batches concurrently and discover sidecar lyrics in the same pass.
  - Scale metadata workers to available processors with a NAS-friendly cap.
  - Reuse cached tags, serialize concurrent rescans, and keep media streaming independent from cache writes.
  - Reaching the final lyric must not move the whole player downward.
  - No black bar should appear at the bottom.
  - Verify manual scrolling and automatic active-line scrolling on desktop and mobile.

## Navigation And Metadata

- [x] Make every meaningful artist, album, and track reference clickable throughout the app.
  - Artist names open the artist page.
  - Album names and artwork open the album page.
  - Track titles open the appropriate track or album context where useful.
  - Expanded and compact now-playing views show both artist and album links.
  - Example: while playing "Pink Pony Club," clicking "Chappell Roan" opens the artist and clicking its album opens the album.
  - Cover library rows, search results, favorites, recent plays, playlists, detail pages, and both player layouts.

- [x] Add richer artist pages.
  - Show biography, genres, imagery, albums, popular tracks, favorites, play counts, and recently played tracks where data is available.
  - Keep local library metadata authoritative and enrich it with cached online data.
  - Handle missing online artist data gracefully.

## Settings And Visualizer

- [x] Add a user settings area.
  - Library folders and rescanning controls.
  - Online metadata and lyrics preferences.
  - Playback and queue behavior.
  - Appearance and accessibility options.
  - Visualizer controls.
  - Persist settings between launches.

- [x] Make the visualizer customizable and less prominent by default.
  - Add intensity, opacity, color, and motion controls.
  - Add multiple styles, including subtle waveform, spectrum, ambient bars, and off.
  - Respect reduced-motion preferences.
  - Keep controls and track information readable while it is active.

## UI Quality

- [x] Complete an overall UI polish pass.
  - Improve spacing, alignment, hierarchy, responsive behavior, loading states, empty states, and focus states.
  - Check long titles, missing artwork, small windows, and mobile layouts.
  - Keep controls consistent between compact and expanded players.

- [x] Run a bug-finding and bug-fixing pass.
  - Playback, pause, seek, previous/next, shuffle, repeat, queue, and volume.
  - Local, embedded, and online lyrics.
  - Search, sorting, navigation history, menus, and links.
  - Importing/rescanning large NAS libraries and handling unavailable files.
  - Favorites, recent plays, playlists, persistence, and restart behavior.
  - Desktop and mobile layouts at representative viewport sizes.
  - Keyboard navigation, accessible names, disabled states, and focus visibility.
  - Performance with the 10,000-track fixture.

## Completion Checks

- [x] Add focused automated tests for each fixed regression and major new workflow.
- [x] Capture desktop and mobile screenshots for visual review.
- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [x] Run `npm run test:smoke`.
- [x] Run `npm run test:performance`.
- [x] Package and launch the updated portable Windows release.

## Large Library And Discovery Update

- [x] Add stat-aware incremental scans, artwork deduplication, automatic folder watching, and NAS polling fallback.
- [x] Preserve track identity across uniquely matched file moves and renames.
- [x] Add collapsible Library navigation with genre and decade discovery.
- [x] Add thumbs-up, thumbs-down, playlist, shuffle, and repeat actions to expanded playback.
- [x] Feed explicit ratings into Supermix and exclude disliked tracks.
- [x] Enrich artist pages with social links and local-only ListenBrainz popularity.
- [x] Optimize artist/album lookup, lyric timing, elapsed updates, and expanded artwork rendering.
- [x] Validate Songs and search with a 20,000-track fixture.
- [x] Capture real desktop and mobile screenshots and refresh the README.
