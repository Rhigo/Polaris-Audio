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
}

export interface Library {
  folder: string
  tracks: Track[]
  history: string[]
  favorites: string[]
  playlists: Playlist[]
  settings: Settings
}

export interface LyricLine { time: number | null; text: string }
export interface ScanProgress { current: number; total: number }
export interface ArtistImages { profile: string; background: string; biography?: string; genres?: string[]; cachedAt?: number }

declare global {
  interface Window {
    polaris?: {
      getLibrary: () => Promise<Library>
      chooseFolder: () => Promise<Library | null>
      rescan: (folder: string) => Promise<Library>
      saveState: (state: Partial<Pick<Library, 'history' | 'favorites' | 'playlists' | 'settings'>>) => Promise<void>
      getLyrics: (lyricPath: string, embedded?: string, trackPath?: string, track?: Pick<Track, 'title' | 'artist' | 'album' | 'duration'>) => Promise<LyricLine[]>
      getArtistImage: (artist: string) => Promise<ArtistImages>
      onScanProgress: (callback: (progress: ScanProgress) => void) => () => void
    }
  }
}