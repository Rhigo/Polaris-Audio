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
}

export interface Playlist {
  id: string
  name: string
  trackIds: string[]
  createdAt: number
  updatedAt: number
}

export type VisualizerStyle = 'spectrum' | 'waveform' | 'ambient' | 'off'

export interface Settings {
  onlineLyrics: boolean
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
}

export interface Library {
  folder: string
  tracks: Track[]
  history: string[]
  favorites: string[]
  liked: string[]
  disliked: string[]
  playlists: Playlist[]
  settings: Settings
}

export interface LyricLine { time: number | null; text: string }
export interface ScanProgress { current: number; total: number }
export interface ArtistLink { label: string; url: string }
export interface PopularRecording { title: string; listens: number; listeners: number }
export interface ArtistImages { profile: string; background: string; biography?: string; genres?: string[]; links?: ArtistLink[]; topRecordings?: PopularRecording[]; cachedAt?: number }

declare global {
  interface Window {
    polaris?: {
      getLibrary: () => Promise<Library>
      chooseFolder: () => Promise<Library | null>
      rescan: (folder: string) => Promise<Library>
      saveState: (state: Partial<Pick<Library, 'history' | 'favorites' | 'liked' | 'disliked' | 'playlists' | 'settings'>>) => Promise<void>
      getLyrics: (lyricPath: string, embedded?: string, trackPath?: string, track?: Pick<Track, 'title' | 'artist' | 'album' | 'duration'>) => Promise<LyricLine[]>
      getArtistImage: (artist: string) => Promise<ArtistImages>
      onScanProgress: (callback: (progress: ScanProgress) => void) => () => void
      onLibraryUpdated: (callback: (library: Library) => void) => () => void
    }
  }
}