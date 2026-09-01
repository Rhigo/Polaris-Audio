export interface Track {
  id: string
  path: string
  url: string
  title: string
  artist: string
  albumArtist: string
  album: string
  year: number
  track: number
  disc: number
  genre: string
  duration: number
  sampleRate: number
  bitDepth: number
  lossless: boolean
  artwork: string
  lyricPath: string
  embeddedLyrics?: string
  addedAt: number
  fileSize?: number
  modifiedAt?: number
  sourceType?: 'local' | 'jellyfin'
  sourceId?: string
  remoteId?: string
}

export interface Playlist {
  id: string
  name: string
  trackIds: string[]
  createdAt: number
  updatedAt: number
}

export type VisualizerStyle = 'spectrum' | 'waveform' | 'ambient' | 'off'
export type AccentColor = '#6832c2' | '#f0504d' | '#e04787' | '#197f8c' | '#2f73c9' | '#3d8b61' | '#c27b28'

export interface Settings {
  onlineLyrics: boolean
  staticLyricsAutoScroll: boolean
  lyricsContrast: 'normal' | 'high' | 'maximum'
  visualizerStyle: VisualizerStyle
  visualizerIntensity: number
  visualizerOpacity: number
  visualizerColor: string
  reduceMotion: boolean
  volume: number
  shuffle: boolean
  repeat: 'off' | 'all' | 'one'
  libraryExpanded: boolean
  dynamicBackground: boolean
  accentColor: AccentColor
}

export interface JellyfinServer {
  id: string
  url: string
  name: string
  username: string
  userId: string
  lastSyncedAt: number
}

export interface Library {
  folders: string[]
  folder: string
  tracks: Track[]
  history: string[]
  favorites: string[]
  liked: string[]
  disliked: string[]
  playlists: Playlist[]
  jellyfinServers: JellyfinServer[]
  settings: Settings
}

export interface LyricLine { time: number | null; text: string }
export interface ScanProgress { current: number; total: number }
export interface ArtistLink { label: string; url: string }
export interface PopularRecording { title: string; listens: number; listeners: number }
export interface ArtistImages { profile: string; background: string; biography?: string; genres?: string[]; links?: ArtistLink[]; topRecordings?: PopularRecording[]; rankingVersion?: number; requestedArtist?: string; resolvedArtist?: string; cachedAt?: number }
export interface UpdateInfo { currentVersion: string; latestVersion: string; available: boolean; releaseUrl: string; downloadUrl: string; checkedAt: number; error?: string }

declare global {
  interface Window {
    polaris?: {
      getLibrary: () => Promise<Library>
      addSource: () => Promise<Library | null>
      removeSource: (folder: string) => Promise<Library>
      rescan: () => Promise<Library>
      connectJellyfin: (credentials: { url: string; username: string; password: string }) => Promise<Library>
      refreshJellyfin: (serverId: string) => Promise<Library>
      disconnectJellyfin: (serverId: string) => Promise<Library>
      saveState: (state: Partial<Pick<Library, 'history' | 'favorites' | 'liked' | 'disliked' | 'playlists' | 'settings'>>) => Promise<void>
      getLyrics: (lyricPath: string, embedded?: string, trackPath?: string, track?: Pick<Track, 'title' | 'artist' | 'album' | 'duration'>) => Promise<LyricLine[]>
      getArtistImage: (artist: string) => Promise<ArtistImages>
      openExternal: (url: string) => Promise<boolean>
      checkForUpdates: () => Promise<UpdateInfo>
      onScanProgress: (callback: (progress: ScanProgress) => void) => () => void
      onLibraryUpdated: (callback: (library: Library) => void) => () => void
    }
  }
}