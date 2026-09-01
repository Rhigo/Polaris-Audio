import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Album, ArrowLeft, AudioLines, ChevronDown, Cloud, Code2, Disc3, Download, ExternalLink, FolderPlus, Heart, Home, Library as LibraryIcon,
  ChevronRight, GripVertical, ListMusic, Maximize2, Mic2, MoreHorizontal, Music2, Pause, Play, Plus, RefreshCw,
  Repeat, Repeat1, ScrollText, Search, Shuffle, SkipBack, SkipForward, SlidersHorizontal, Sparkles,
  Settings as SettingsIcon, ThumbsDown, ThumbsUp, Trash2, UserRound, Volume1, Volume2, VolumeX, WandSparkles, X,
} from 'lucide-react'
import type { ArtistImages, Library, LyricLine, Playlist, ScanProgress, Settings, Track, UpdateInfo } from './types'
import './App.css'
import logoUrl from './assets/logo.png'

type View = 'home' | 'supermix' | 'recent' | 'artists' | 'albums' | 'songs' | 'genres' | 'decades' | 'favorites' | 'playlist' | 'settings'
type RepeatMode = 'off' | 'all' | 'one'
type SearchTab = 'songs' | 'albums' | 'artists'
type SongSort = 'title-asc' | 'title-desc' | 'artist-asc' | 'album-asc' | 'newest' | 'duration'
type AlbumSort = 'title-asc' | 'title-desc' | 'artist-asc' | 'year-desc' | 'year-asc'
type ArtistSort = 'name-asc' | 'name-desc' | 'songs-desc' | 'songs-asc'
interface Location { view: View; artist: string; album: string; playlist: string; genre: string; decade: number; query: string; searchTab: SearchTab }

const defaultSettings: Settings = {
  onlineLyrics: true, staticLyricsAutoScroll: true, lyricsContrast: 'high', visualizerStyle: 'spectrum', visualizerIntensity: 0.55,
  visualizerOpacity: 0.24, visualizerColor: '#f6f3ed', reduceMotion: false, volume: 0.82, shuffle: false, repeat: 'off',
  libraryExpanded: true, dynamicBackground: true, accentColor: '#6832c2',
}
const emptyLibrary: Library = { folders: [], folder: '', tracks: [], history: [], favorites: [], liked: [], disliked: [], playlists: [], jellyfinServers: [], settings: defaultSettings }
const artColors = ['#cd493f', '#18737f', '#a37736', '#485ca8', '#9c4368', '#557248']
const accentPresets = [
  { name: 'Polaris purple', color: '#6832c2' }, { name: 'Coral', color: '#f0504d' },
  { name: 'Rose', color: '#e04787' }, { name: 'Teal', color: '#197f8c' },
  { name: 'Ocean', color: '#2f73c9' }, { name: 'Fern', color: '#3d8b61' },
  { name: 'Amber', color: '#c27b28' },
] as const
const rowBatchSize = 250

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return '0:00'
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
}

const normalizedTitle = (title: string) => title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

function titleKeys(title: string) {
  const withoutFeatures = title.replace(/\s+(?:feat(?:uring)?|ft)\.?\s+.+$/i, '')
  const withoutEdition = withoutFeatures
    .replace(/\s*[([].*?[)\]]/g, '')
    .replace(/\s+-\s+(?:remaster(?:ed)?|live|acoustic|radio edit|album version|single version|explicit|clean|remix).*$/i, '')
  return [...new Set([normalizedTitle(title), normalizedTitle(withoutFeatures), normalizedTitle(withoutEdition)].filter(Boolean))]
}

function findActiveLyric(lines: LyricLine[], elapsed: number) {
  let low = 0
  let high = lines.length - 1
  let active = -1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const time = lines[middle].time
    if (time !== null && time <= elapsed) { active = middle; low = middle + 1 } else high = middle - 1
  }
  return active
}

function uniqueBy<T>(items: T[], key: (item: T) => string) {
  return [...new Map(items.map((item) => [key(item), item])).values()]
}

const compareText = (left: string, right: string) => left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true })

function sortedSongs(tracks: Track[], sort: SongSort) {
  return [...tracks].sort((left, right) => {
    if (sort === 'title-desc') return compareText(right.title, left.title)
    if (sort === 'artist-asc') return compareText(left.artist, right.artist) || compareText(left.title, right.title)
    if (sort === 'album-asc') return compareText(left.album, right.album) || left.track - right.track
    if (sort === 'newest') return right.addedAt - left.addedAt
    if (sort === 'duration') return right.duration - left.duration
    return compareText(left.title, right.title)
  })
}

function sortedAlbums(tracks: Track[], sort: AlbumSort) {
  return [...tracks].sort((left, right) => {
    if (sort === 'title-desc') return compareText(right.album, left.album)
    if (sort === 'artist-asc') return compareText(left.albumArtist, right.albumArtist) || compareText(left.album, right.album)
    if (sort === 'year-desc') return right.year - left.year || compareText(left.album, right.album)
    if (sort === 'year-asc') return left.year - right.year || compareText(left.album, right.album)
    return compareText(left.album, right.album)
  })
}

function sortedArtists(tracks: Track[], sort: ArtistSort, counts: Map<string, number>) {
  return [...tracks].sort((left, right) => {
    const leftName = left.artist || left.albumArtist
    const rightName = right.artist || right.albumArtist
    if (sort === 'name-desc') return compareText(rightName, leftName)
    if (sort === 'songs-desc') return (counts.get(rightName) || 0) - (counts.get(leftName) || 0) || compareText(leftName, rightName)
    if (sort === 'songs-asc') return (counts.get(leftName) || 0) - (counts.get(rightName) || 0) || compareText(leftName, rightName)
    return compareText(leftName, rightName)
  })
}

function buildSupermix(tracks: Track[], history: string[], favoriteIds: string[], likedIds: string[], dislikedIds: string[], variation: number) {
  const recent = new Map(history.map((id, index) => [id, index]))
  const favorites = new Set(favoriteIds)
  const liked = new Set(likedIds)
  const disliked = new Set(dislikedIds)
  const favoriteArtists = new Map<string, number>()
  const favoriteGenres = new Map<string, number>()
  for (const track of tracks) {
    if (!favorites.has(track.id)) continue
    favoriteArtists.set(track.artist, (favoriteArtists.get(track.artist) || 0) + 1)
    if (track.genre) favoriteGenres.set(track.genre, (favoriteGenres.get(track.genre) || 0) + 1)
  }
  const score = (track: Track) => {
    const historyIndex = recent.get(track.id)
    const affinity = (favorites.has(track.id) ? 20 : 0) + (liked.has(track.id) ? 35 : 0) - (disliked.has(track.id) ? 1000 : 0) + (favoriteArtists.get(track.artist) || 0) * 4 + (favoriteGenres.get(track.genre) || 0) * 2
    const recency = historyIndex === undefined ? 6 : historyIndex < 20 ? -10 + historyIndex * 0.3 : 2
    const noise = Math.abs(Math.sin([...track.id].reduce((sum, char) => sum + char.charCodeAt(0), variation + 1))) * 8
    return affinity + recency + noise
  }
  const candidates = tracks.filter((track) => !disliked.has(track.id)).sort((left, right) => score(right) - score(left))
  const result: Track[] = []
  for (const track of candidates) {
    if (result.length >= 100) break
    if (result.at(-1)?.artist === track.artist && result.at(-2)?.artist === track.artist) continue
    result.push(track)
  }
  return result
}

function newPlaylist(name: string): Playlist {
  const timestamp = Date.now()
  return { id: crypto.randomUUID(), name, trackIds: [], createdAt: timestamp, updatedAt: timestamp }
}

function SortControl<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return <label className="sort-control"><SlidersHorizontal /><span>Sort</span><select value={value} onChange={(event) => onChange(event.target.value as T)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown /></label>
}

function Artwork({ track, size = 'medium' }: { track?: Track; size?: 'small' | 'medium' | 'large' }) {
  const color = track ? artColors[Math.abs(track.album.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)) % artColors.length] : artColors[1]
  const artwork = track?.artwork?.startsWith('polaris://jellyfin/') && size === 'small' ? `${track.artwork}?maxWidth=128` : track?.artwork
  return (
    <div className={`artwork artwork--${size}`} style={{ '--art-color': color } as React.CSSProperties}>
      <Disc3 aria-hidden="true" />
      {artwork && <img src={artwork} alt={`${track?.album} cover`} loading="lazy" decoding="async" onError={(event) => { event.currentTarget.style.display = 'none' }} />}
    </div>
  )
}

function IconButton({ label, active, disabled = false, children, onClick, className = '' }: {
  label: string; active?: boolean; disabled?: boolean; children: ReactNode; onClick?: () => void; className?: string
}) {
    return <button className={`icon-button ${active ? 'active' : ''} ${className}`} disabled={disabled} onClick={(event) => { event.stopPropagation(); if (onClick) onClick() }} title={label} aria-label={label}>{children}</button>
}

function LyricsDisplay({ lines, loading, activeLine, elapsed, duration, staticAutoScroll, onStaticAutoScrollChange, onSeek, onBack, contrast = 'high', className = '' }: {
  lines: LyricLine[]; loading: boolean; activeLine: number; elapsed: number; duration: number; staticAutoScroll: boolean; onStaticAutoScrollChange: (enabled: boolean) => void; onSeek: (time: number) => void; onBack?: () => void; contrast?: Settings['lyricsContrast']; className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const staticLyrics = lines.length > 0 && lines.every((line) => line.time === null)
  useEffect(() => {
    if (activeLine < 0) return
    containerRef.current?.querySelector('.active')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [activeLine])
  useEffect(() => {
    const container = containerRef.current
    if (!container || !staticLyrics || !staticAutoScroll || duration <= 0) return
    const scrollable = Math.max(0, container.scrollHeight - container.clientHeight)
    container.scrollTo({ top: scrollable * Math.min(1, Math.max(0, elapsed / duration)), behavior: 'smooth' })
  }, [duration, elapsed, staticAutoScroll, staticLyrics])
  return <div ref={containerRef} className={`lyrics lyrics-${contrast} ${!lines.length ? 'lyrics-empty' : ''} ${staticLyrics ? 'lyrics-static' : ''} ${className}`}>{onBack && <button className="lyrics-back" onClick={onBack}><ArrowLeft />Back to artwork</button>}{staticLyrics && <label className="lyrics-auto-scroll"><span>Auto-scroll</span><input type="checkbox" checked={staticAutoScroll} onChange={(event) => onStaticAutoScrollChange(event.target.checked)} /></label>}{lines.length ? lines.map((line, index) => line.time === null ? <span className="lyric-line" key={`static-${index}`}>{line.text}</span> : <button key={`${line.time}-${index}`} className={index === activeLine ? 'active' : ''} onClick={() => onSeek(line.time as number)}>{line.text}</button>) : loading ? <><RefreshCw className="spin" /><strong>Finding lyrics</strong><span>Checking local tags and LRCLIB…</span></> : <><Mic2 /><strong>No lyrics found</strong><span>No local, embedded, or online lyrics are available.</span></>}</div>
}

function ArtistCard({ artist, count, onClick }: { artist: string; count: number; onClick: () => void }) {
  const [images, setImages] = useState<ArtistImages>({ profile: '', background: '' })
  const cardRef = useRef<HTMLButtonElement>(null)
    useEffect(() => {
      const card = cardRef.current
      if (!card || !window.polaris) return
    let current = true
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return
      observer.disconnect()
        window.polaris?.getArtistImage(artist).then((value) => { if (current) setImages(value) })
    }, { rootMargin: '160px' })
    observer.observe(card)
    return () => { current = false; observer.disconnect() }
  }, [artist])
  return (
    <button ref={cardRef} className="artist-card" onClick={onClick}>
      <div className="artist-photo" style={images.profile ? { backgroundImage: `url("${images.profile}")` } : undefined}>
        {!images.profile && <UserRound />}
      </div>
      <strong>{artist}</strong><span>{count} {count === 1 ? 'song' : 'songs'}</span>
    </button>
  )
}

function Visualizer({ analyser, running, settings }: { analyser: AnalyserNode | null; running: boolean; settings: Settings }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { visualizerStyle, visualizerIntensity, visualizerOpacity, visualizerColor } = settings
  useEffect(() => {
    if (!analyser || !running) return
    let frame = 0
    let lastDraw = 0
    const data = new Uint8Array(analyser.frequencyBinCount)
    const draw = (timestamp: number) => {
      frame = requestAnimationFrame(draw)
      if (timestamp - lastDraw < 33) return
      lastDraw = timestamp
      const canvas = canvasRef.current
      if (!canvas) return
      const context = canvas.getContext('2d')
      if (!context) return
      const ratio = Math.min(2, window.devicePixelRatio || 1)
      const width = canvas.clientWidth * ratio
      const height = canvas.clientHeight * ratio
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
      if (visualizerStyle === 'waveform') analyser.getByteTimeDomainData(data)
      else analyser.getByteFrequencyData(data)
      context.clearRect(0, 0, width, height)
      const bars = Math.min(72, Math.floor(width / (7 * ratio)))
      const step = Math.max(1, Math.floor(data.length * 0.55 / bars))
      for (let index = 0; index < bars; index += 1) {
        const raw = visualizerStyle === 'waveform' ? Math.abs(data[index * step] - 128) / 128 : data[index * step] / 255
        const value = Math.min(1, raw * (0.45 + visualizerIntensity * 1.3))
        const barHeight = Math.max(2 * ratio, value * height * (visualizerStyle === 'ambient' ? 0.42 : 0.88))
        const barWidth = width / bars - 3 * ratio
        context.globalAlpha = visualizerOpacity * (0.35 + value * 0.65)
        context.fillStyle = visualizerColor
        context.fillRect(index * width / bars, height - barHeight, barWidth, barHeight)
      }
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [analyser, running, visualizerColor, visualizerIntensity, visualizerOpacity, visualizerStyle])
  return <canvas className="visualizer" ref={canvasRef} />
}

function App() {
  const [library, setLibrary] = useState<Library>(emptyLibrary)
  const [view, setView] = useState<View>('home')
  const [query, setQuery] = useState('')
  const [searchTab, setSearchTab] = useState<SearchTab>('songs')
  const [songSort, setSongSort] = useState<SongSort>('title-asc')
  const [albumSort, setAlbumSort] = useState<AlbumSort>('title-asc')
  const [artistSort, setArtistSort] = useState<ArtistSort>('name-asc')
  const [selectedAlbum, setSelectedAlbum] = useState('')
  const [selectedArtist, setSelectedArtist] = useState('')
  const [selectedPlaylist, setSelectedPlaylist] = useState('')
  const [selectedGenre, setSelectedGenre] = useState('')
  const [selectedDecade, setSelectedDecade] = useState(0)
  const [playlistName, setPlaylistName] = useState('')
  const [renameDraft, setRenameDraft] = useState('')
  const [renamingPlaylist, setRenamingPlaylist] = useState(false)
  const [supermixVariation, setSupermixVariation] = useState(0)
  const [supermixHistory, setSupermixHistory] = useState<string[]>([])
  const [detailHistory, setDetailHistory] = useState<Location[]>([])
  const [artistImage, setArtistImage] = useState<{ artist: string; images: ArtistImages }>({ artist: '', images: { profile: '', background: '' } })
  const [scan, setScan] = useState<ScanProgress | null>(null)
  const [queue, setQueue] = useState<Track[]>([])
  const [queueIndex, setQueueIndex] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolumeState] = useState(defaultSettings.volume)
  const [shuffle, setShuffle] = useState(defaultSettings.shuffle)
  const [repeat, setRepeat] = useState<RepeatMode>(defaultSettings.repeat)
  const [lyricsOpen, setLyricsOpen] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)
  const [visualizerOpen, setVisualizerOpen] = useState(false)
  const [lyrics, setLyrics] = useState<LyricLine[]>([])
  const [lyricsTrackId, setLyricsTrackId] = useState('')
  const [mobilePlayer, setMobilePlayer] = useState(false)
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)
  const [playbackError, setPlaybackError] = useState('')
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [checkingForUpdates, setCheckingForUpdates] = useState(false)
  const [updateDismissed, setUpdateDismissed] = useState(false)
  const [openRowMenu, setOpenRowMenu] = useState('')
  const [rowWindow, setRowWindow] = useState({ key: '', count: rowBatchSize })
  const audioRef = useRef<HTMLAudioElement>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const lastElapsedUpdate = useRef(0)
  const volumeFrame = useRef(0)
  const pendingVolume = useRef(defaultSettings.volume)
  const settingsPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const settingsRef = useRef(defaultSettings)
  const settingsDirty = useRef(false)
  const playbackRetryCount = useRef(0)
  const playbackRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const playbackMetadataRetry = useRef<(() => void) | null>(null)
  const current = queue[queueIndex]
  const currentTrackId = useRef<string | undefined>(current?.id)
  const sourceCount = library.folders.length + library.jellyfinServers.length

  const setVolume = (value: number) => {
    pendingVolume.current = value
    if (audioRef.current) audioRef.current.volume = value
    if (volumeFrame.current) return
    volumeFrame.current = requestAnimationFrame(() => {
      volumeFrame.current = 0
      setVolumeState(pendingVolume.current)
    })
  }

  useEffect(() => {
    window.polaris?.getLibrary().then((value) => {
      setLibrary(value)
      setSupermixHistory(value.history)
      settingsRef.current = value.settings
      setVolume(value.settings.volume)
      setShuffle(value.settings.shuffle)
      setRepeat(value.settings.repeat)
      setVisualizerOpen(false)
    })
    return window.polaris?.onScanProgress((progress) => setScan(progress.total > 0 && progress.current >= progress.total ? null : progress))
  }, [])

  useEffect(() => window.polaris?.onLibraryUpdated((value) => { setLibrary(value); setSupermixHistory(value.history); setScan(null) }), [])

  useEffect(() => {
    window.polaris?.checkForUpdates().then((info) => setUpdateInfo(info))
  }, [])

  const runUpdateCheck = async () => {
    setCheckingForUpdates(true)
    const info = await window.polaris?.checkForUpdates()
    if (info) { setUpdateInfo(info); if (info.available) setUpdateDismissed(false) }
    setCheckingForUpdates(false)
  }

  useEffect(() => {
    settingsRef.current = library.settings
  }, [library.settings])

  useEffect(() => {
    if (!openRowMenu) return
    const closeMenu = () => setOpenRowMenu('')
    document.addEventListener('click', closeMenu)
    return () => document.removeEventListener('click', closeMenu)
  }, [openRowMenu])

  useEffect(() => {
    const navigate = (event: Event) => {
      const track = (event as CustomEvent<Track>).detail
      setDetailHistory((history) => [...history, { view, artist: selectedArtist, album: selectedAlbum, playlist: selectedPlaylist, genre: selectedGenre, decade: selectedDecade, query, searchTab }])
      setQuery('')
      setSelectedArtist(track.albumArtist || track.artist)
      setSelectedAlbum('')
      setSelectedPlaylist('')
      setView('artists')
    }
    window.addEventListener('polaris:open-artist', navigate)
    return () => window.removeEventListener('polaris:open-artist', navigate)
  }, [query, searchTab, selectedAlbum, selectedArtist, selectedDecade, selectedGenre, selectedPlaylist, view])

  useEffect(() => {
    if (!current) return
    let active = true
    window.polaris?.getLyrics(current.lyricPath, current.embeddedLyrics, current.path, current).then((lines) => { if (active) { setLyrics(lines); setLyricsTrackId(current.id) } })
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: current.title, artist: current.artist, album: current.album,
        artwork: /^(?:https?|data|blob):/i.test(current.artwork) ? [{ src: current.artwork }] : [],
      })
    }
    return () => { active = false }
  }, [current])

  useEffect(() => {
    let active = true
    if (!selectedArtist) return
    window.polaris?.getArtistImage(selectedArtist).then((images) => { if (active) setArtistImage({ artist: selectedArtist, images }) })
    return () => { active = false }
  }, [selectedArtist])

  useEffect(() => () => {
    if (volumeFrame.current) cancelAnimationFrame(volumeFrame.current)
    if (settingsPersistTimer.current) clearTimeout(settingsPersistTimer.current)
    if (settingsDirty.current) window.polaris?.saveState({ settings: settingsRef.current })
  }, [])

  const ensureAnalyser = () => {
    if (audioContextRef.current || !audioRef.current) return
    const context = new AudioContext()
    try {
      const source = context.createMediaElementSource(audioRef.current)
      const node = context.createAnalyser()
      node.fftSize = 256
      source.connect(node)
      node.connect(context.destination)
      audioContextRef.current = context
      setAnalyser(node)
    } catch {
      context.close().catch(() => {})
    }
  }

  const resumeAudioGraph = () => audioContextRef.current?.resume().catch(() => {})

  const playTrack = (track: Track, tracks = library.tracks) => {
    resumeAudioGraph()
    setPlaybackError('')
    setLyrics([])
    const nextQueue = tracks.length ? tracks : [track]
    setQueue(nextQueue)
    setQueueIndex(Math.max(0, nextQueue.findIndex((item) => item.id === track.id)))
    setPlaying(true)
    const history = [track.id, ...library.history.filter((id) => id !== track.id)].slice(0, 100)
    setLibrary((value) => ({ ...value, history }))
    window.polaris?.saveState({ history })
  }

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !current) return
    currentTrackId.current = current.id
    playbackRetryCount.current = 0
    if (playbackRetryTimer.current) clearTimeout(playbackRetryTimer.current)
    if (playbackMetadataRetry.current) audio.removeEventListener('loadedmetadata', playbackMetadataRetry.current)
    playbackMetadataRetry.current = null
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
    audio.src = current.url
    setElapsed(0)
    setDuration(current.duration)
    return () => {
      currentTrackId.current = undefined
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      if (playbackRetryTimer.current) clearTimeout(playbackRetryTimer.current)
      if (playbackMetadataRetry.current) audio.removeEventListener('loadedmetadata', playbackMetadataRetry.current)
      playbackMetadataRetry.current = null
    }
  }, [current])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !current) return
    const trackId = current.id
    if (playing) audio.play().catch((error: unknown) => {
      if (currentTrackId.current !== trackId || error instanceof DOMException && error.name === 'AbortError') return
      setPlaying(false)
      setPlaybackError(error instanceof Error ? error.message : 'This song could not be started.')
    })
    else audio.pause()
  }, [playing, current])

  const moveTrack = (direction: number) => {
    if (!queue.length) return
    resumeAudioGraph()
    if (shuffle && direction > 0 && queue.length > 1) setQueueIndex((index) => (index + 1 + Math.floor(Math.random() * (queue.length - 1))) % queue.length)
    else setQueueIndex((index) => (index + direction + queue.length) % queue.length)
    setPlaying(true)
  }

  const handlePlaybackError = (audio: HTMLAudioElement) => {
    const message = audio.error?.message || ''
    const recoverable = audio.error?.code === MediaError.MEDIA_ERR_NETWORK || /PIPELINE_ERROR_READ|data source error/i.test(message)
    if (recoverable && current && playbackRetryCount.current < 5) {
      playbackRetryCount.current += 1
      const resumeAt = audio.currentTime || elapsed
      const retryTrackId = current.id
      const retryUrl = current.url
      playbackRetryTimer.current = setTimeout(() => {
        if (currentTrackId.current !== retryTrackId) return
        if (playbackMetadataRetry.current) audio.removeEventListener('loadedmetadata', playbackMetadataRetry.current)
        const resumePlayback = () => {
          playbackMetadataRetry.current = null
          if (currentTrackId.current !== retryTrackId) return
          audio.currentTime = Math.min(resumeAt, Number.isFinite(audio.duration) ? audio.duration : resumeAt)
          audio.play().then(() => setPlaying(true)).catch(() => {})
        }
        playbackMetadataRetry.current = resumePlayback
        audio.addEventListener('loadedmetadata', resumePlayback, { once: true })
        audio.src = retryUrl
        audio.load()
      }, Math.min(3000, 500 * (2 ** (playbackRetryCount.current - 1))))
      return
    }
    setPlaying(false)
    setPlaybackError(audio.error?.message || 'This audio format could not be played.')
  }

  const onEnded = () => {
    if (repeat === 'one' && audioRef.current) { audioRef.current.currentTime = 0; audioRef.current.play() }
    else if (queueIndex < queue.length - 1 || repeat === 'all') moveTrack(1)
    else setPlaying(false)
  }

  const toggleFavorite = (id: string) => {
    const favorites = library.favorites.includes(id) ? library.favorites.filter((item) => item !== id) : [...library.favorites, id]
    setLibrary((value) => ({ ...value, favorites }))
    window.polaris?.saveState({ favorites })
  }

  const rateTrack = (id: string, rating: 'up' | 'down') => {
    const liked = rating === 'up' ? (library.liked.includes(id) ? library.liked.filter((item) => item !== id) : [...library.liked, id]) : library.liked.filter((item) => item !== id)
    const disliked = rating === 'down' ? (library.disliked.includes(id) ? library.disliked.filter((item) => item !== id) : [...library.disliked, id]) : library.disliked.filter((item) => item !== id)
    setLibrary((value) => ({ ...value, liked, disliked }))
    window.polaris?.saveState({ liked, disliked })
  }

  const persistLibraryState = (state: Partial<Pick<Library, 'playlists' | 'settings'>>) => {
    setLibrary((value) => ({ ...value, ...state }))
    window.polaris?.saveState(state)
  }

  const updateSettings = (patch: Partial<Settings>) => {
    const settings = { ...settingsRef.current, ...patch }
    settingsRef.current = settings
    if (patch.volume !== undefined && Object.keys(patch).length === 1) {
      settingsDirty.current = true
      if (settingsPersistTimer.current) clearTimeout(settingsPersistTimer.current)
      settingsPersistTimer.current = setTimeout(() => {
        settingsPersistTimer.current = null
        settingsDirty.current = false
        persistLibraryState({ settings: settingsRef.current })
      }, 250)
      return
    }
    if (settingsPersistTimer.current) {
      clearTimeout(settingsPersistTimer.current)
      settingsPersistTimer.current = null
    }
    persistLibraryState({ settings })
  }

  const createPlaylist = () => {
    const name = playlistName.trim()
    if (!name) return
    const playlist = newPlaylist(name)
    persistLibraryState({ playlists: [...library.playlists, playlist] })
    setPlaylistName('')
    setSelectedPlaylist(playlist.id)
    showView('playlist')
  }

  const updatePlaylist = (id: string, update: (playlist: Playlist) => Playlist) => {
    setLibrary((value) => {
      const playlists = value.playlists.map((playlist) => playlist.id === id ? { ...update(playlist), updatedAt: Date.now() } : playlist)
      window.polaris?.saveState({ playlists })
      return { ...value, playlists }
    })
  }

  const addTrackToPlaylist = (playlistId: string, trackId: string) => {
    updatePlaylist(playlistId, (playlist) => playlist.trackIds.includes(trackId) ? playlist : { ...playlist, trackIds: [...playlist.trackIds, trackId] })
    setOpenRowMenu('')
  }

  const removePlaylist = (id: string) => {
    persistLibraryState({ playlists: library.playlists.filter((playlist) => playlist.id !== id) })
    setSelectedPlaylist('')
    showView('home')
  }

  const renameSelectedPlaylist = () => {
    const playlist = library.playlists.find((item) => item.id === selectedPlaylist)
    if (!playlist) return
    setRenameDraft(playlist.name)
    setRenamingPlaylist(true)
  }

  const savePlaylistName = () => {
    const name = renameDraft.trim()
    if (name) updatePlaylist(selectedPlaylist, (playlist) => ({ ...playlist, name }))
    setRenamingPlaylist(false)
  }

  const addSource = async () => {
    setScan({ current: 0, total: 0 })
    const next = await window.polaris?.addSource()
    if (next) { setLibrary(next); setSupermixHistory(next.history); setDetailHistory([]); setSelectedAlbum(''); setSelectedArtist(''); setSelectedPlaylist('') }
    setScan(null)
  }

  const rescan = async () => {
    if (!library.folders.length) return addSource()
    setScan({ current: 0, total: 0 })
    const next = await window.polaris?.rescan()
    if (next) { setLibrary(next); setSupermixHistory(next.history); setDetailHistory([]); setSelectedAlbum(''); setSelectedArtist(''); setSelectedPlaylist('') }
    setScan(null)
  }

  const removeSource = async (folder: string) => {
    setScan({ current: 0, total: 0 })
    const next = await window.polaris?.removeSource(folder)
    if (next) { setLibrary(next); setSupermixHistory(next.history) }
    setScan(null)
  }

  const deferredQuery = useDeferredValue(query)
  const normalizedQuery = deferredQuery.trim().toLowerCase()
  const rowWindowKey = `${view}\0${normalizedQuery}\0${searchTab}\0${songSort}\0${selectedAlbum}\0${selectedArtist}`
  const visibleRows = rowWindow.key === rowWindowKey ? rowWindow.count : rowBatchSize
  const libraryIndex = useMemo(() => {
    const artistCounts = new Map<string, number>()
    const tracksById = new Map<string, Track>()
    const tracksByGenre = new Map<string, Track[]>()
    const tracksByDecade = new Map<number, Track[]>()
    const tracksByArtist = new Map<string, Track[]>()
    const tracksByAlbum = new Map<string, Track[]>()
    const searchText = new Map<string, { all: string; title: string; album: string; artist: string }>()
    for (const track of library.tracks) {
      tracksById.set(track.id, track)
      if (track.genre) { const tracks = tracksByGenre.get(track.genre); if (tracks) tracks.push(track); else tracksByGenre.set(track.genre, [track]) }
      if (track.year) { const decade = Math.floor(track.year / 10) * 10; const tracks = tracksByDecade.get(decade); if (tracks) tracks.push(track); else tracksByDecade.set(decade, [track]) }
      for (const artist of new Set([track.artist, track.albumArtist].filter(Boolean))) { const tracks = tracksByArtist.get(artist); if (tracks) tracks.push(track); else tracksByArtist.set(artist, [track]) }
      const albumKey = `${track.albumArtist}\0${track.album}`
      const albumTracks = tracksByAlbum.get(albumKey)
      if (albumTracks) albumTracks.push(track); else tracksByAlbum.set(albumKey, [track])
      const names = new Set([track.artist, track.albumArtist].filter(Boolean))
      for (const name of names) artistCounts.set(name, (artistCounts.get(name) || 0) + 1)
      searchText.set(track.id, {
        all: `${track.title} ${track.artist} ${track.albumArtist} ${track.album} ${track.genre} ${track.year} ${track.year ? Math.floor(track.year / 10) * 10 + 's' : ''}`.toLowerCase(),
        title: track.title.toLowerCase(), album: track.album.toLowerCase(), artist: `${track.artist} ${track.albumArtist}`.toLowerCase(),
      })
    }
    return {
      artistCounts, tracksById, tracksByGenre, tracksByDecade, tracksByArtist, tracksByAlbum, searchText,
      albums: uniqueBy(library.tracks, (track) => `${track.albumArtist}\0${track.album}`),
      artists: uniqueBy(library.tracks, (track) => track.artist || track.albumArtist),
    }
  }, [library.tracks])
  const artistCount = (artist: string) => libraryIndex.artistCounts.get(artist) || 0
  const historyTracks = useMemo(() => library.history.map((id) => libraryIndex.tracksById.get(id)).filter(Boolean) as Track[], [library.history, libraryIndex])
  const supermixTracks = useMemo(() => buildSupermix(library.tracks, supermixHistory, library.favorites, library.liked, library.disliked, supermixVariation), [library.disliked, library.favorites, library.liked, library.tracks, supermixHistory, supermixVariation])
  const songs = useMemo(() => sortedSongs(library.tracks, songSort), [library.tracks, songSort])
  const albums = useMemo(() => sortedAlbums(libraryIndex.albums, albumSort), [libraryIndex, albumSort])
  const artists = useMemo(() => sortedArtists(libraryIndex.artists, artistSort, libraryIndex.artistCounts), [libraryIndex, artistSort])
  const searchResults = useMemo(() => {
    if (!normalizedQuery) return { matchCount: 0, songs: [], albums: [], artists: [] }
    let matchCount = 0
    const songMatches: Track[] = []
    const albumMatches: Track[] = []
    const artistMatches: Track[] = []
    for (const track of library.tracks) {
      const text = libraryIndex.searchText.get(track.id)
      if (!text) continue
      if (text.all.includes(normalizedQuery)) matchCount += 1
      if (text.title.includes(normalizedQuery)) songMatches.push(track)
      if (text.album.includes(normalizedQuery)) albumMatches.push(track)
      if (text.artist.includes(normalizedQuery)) artistMatches.push(track)
    }
    return {
      matchCount,
      songs: sortedSongs(songMatches, songSort),
      albums: sortedAlbums(uniqueBy(albumMatches, (track) => `${track.albumArtist}\0${track.album}`), albumSort),
      artists: sortedArtists(uniqueBy(artistMatches, (track) => track.artist || track.albumArtist), artistSort, libraryIndex.artistCounts),
    }
  }, [albumSort, artistSort, library.tracks, libraryIndex, normalizedQuery, songSort])

  const rememberLocation = () => setDetailHistory((history) => [...history, { view, artist: selectedArtist, album: selectedAlbum, playlist: selectedPlaylist, genre: selectedGenre, decade: selectedDecade, query, searchTab }])
  const openAlbum = (track: Track) => { rememberLocation(); setQuery(''); setSelectedAlbum(track.album); setSelectedArtist(track.albumArtist); setView('albums'); setOpenRowMenu('') }
  const openArtist = (track: Track, artist = track.artist || track.albumArtist) => { rememberLocation(); setQuery(''); setSelectedArtist(artist); setSelectedAlbum(''); setView('artists'); setOpenRowMenu('') }
  const goBack = () => {
    const previous = detailHistory.at(-1)
    if (previous) {
      setView(previous.view)
      setSelectedArtist(previous.artist)
      setSelectedAlbum(previous.album)
      setSelectedPlaylist(previous.playlist)
      setSelectedGenre(previous.genre)
      setSelectedDecade(previous.decade)
      setQuery(previous.query)
      setSearchTab(previous.searchTab)
      setDetailHistory((history) => history.slice(0, -1))
    } else {
      setQuery('')
      setSelectedAlbum('')
      setSelectedArtist('')
    }
  }
  const showView = (nextView: View) => {
    setView(nextView)
    setSelectedArtist('')
    setSelectedAlbum('')
    if (nextView !== 'playlist') setSelectedPlaylist('')
    if (nextView !== 'genres') setSelectedGenre('')
    if (nextView !== 'decades') setSelectedDecade(0)
    setQuery('')
    setDetailHistory([])
  }

  const updateSearch = (value: string) => {
    if (value && !query) rememberLocation()
    setQuery(value)
    if (value) { setSelectedAlbum(''); setSelectedArtist('') }
  }

  const playNext = (track: Track) => {
    if (!current) return playTrack(track, [track])
    setQueue((tracks) => [...tracks.slice(0, queueIndex + 1), track, ...tracks.slice(queueIndex + 1)])
    setOpenRowMenu('')
  }

  const addToQueue = (track: Track) => {
    if (!current) return playTrack(track, [track])
    setQueue((tracks) => [...tracks, track])
    setOpenRowMenu('')
  }

  const renderRows = (tracks: Track[], playlistId = '') => (
    <div className="track-list">
      <div className="track-head"><span>#</span><span>Title</span><span>Album</span><span>Quality</span><span>Time</span><span /></div>
      {tracks.slice(0, visibleRows).map((track, index) => (
        <div className={`track-row ${current?.id === track.id ? 'is-current' : ''}`} key={track.id} draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/polaris-track', track.id) }} onDragOver={(event) => { if (playlistId) event.preventDefault() }} onDrop={(event) => {
          if (!playlistId) return
          event.preventDefault()
          const sourceId = event.dataTransfer.getData('text/polaris-track')
          const bounds = event.currentTarget.getBoundingClientRect()
          const insertAfterTarget = event.clientY >= bounds.top + bounds.height / 2
          updatePlaylist(playlistId, (playlist) => {
            const sourceIndex = playlist.trackIds.indexOf(sourceId)
            const targetIndex = playlist.trackIds.indexOf(track.id)
            if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return playlist
            const ids = [...playlist.trackIds]
            ids.splice(sourceIndex, 1)
            let insertionIndex = targetIndex + Number(insertAfterTarget)
            if (sourceIndex < insertionIndex) insertionIndex -= 1
            ids.splice(insertionIndex, 0, sourceId)
            return { ...playlist, trackIds: ids }
          })
        }} onDoubleClick={() => playTrack(track, tracks)}>
          <button className="track-number" onClick={() => playTrack(track, tracks)} aria-label={`Play ${track.title}`}>
            <span>{playlistId ? <GripVertical /> : current?.id === track.id && playing ? <AudioLines /> : index + 1}</span><Play className="row-play" />
          </button>
          <div className="track-title"><button className="track-art-play" onClick={() => playTrack(track, tracks)} aria-label={`Artwork for ${track.title}`}><Artwork track={track} size="small" /></button><button className="track-name" onClick={() => playTrack(track, tracks)}>{track.title}</button><button className="track-artist" onClick={() => openArtist(track)}>{track.artist}</button></div>
          <button className="plain-cell" onClick={() => openAlbum(track)}>{track.album}</button>
          <span className="quality">{track.lossless ? `${track.bitDepth || 16}/${Math.round((track.sampleRate || 44100) / 100) / 10}` : track.path.split('.').pop()?.toUpperCase()}</span>
          <span className="time-cell">{formatTime(track.duration)}</span>
          <div className="row-menu-wrap" onClick={(event) => event.stopPropagation()}><IconButton label={`More options for ${track.title}`} active={openRowMenu === track.id} onClick={() => setOpenRowMenu(openRowMenu === track.id ? '' : track.id)}><MoreHorizontal /></IconButton>{openRowMenu === track.id && <div className="row-menu"><button onClick={() => playNext(track)}><Play />Play next</button><button onClick={() => addToQueue(track)}><ListMusic />Add to queue</button><button onClick={() => { toggleFavorite(track.id); setOpenRowMenu('') }}><Heart />{library.favorites.includes(track.id) ? 'Remove from loved songs' : 'Add to loved songs'}</button>{library.playlists.map((playlist) => <button key={playlist.id} onClick={() => addTrackToPlaylist(playlist.id, track.id)}><Plus />Add to {playlist.name}</button>)}{playlistId && <button onClick={() => { updatePlaylist(playlistId, (playlist) => ({ ...playlist, trackIds: playlist.trackIds.filter((id) => id !== track.id) })); setOpenRowMenu('') }}><Trash2 />Remove from playlist</button>}<span /><button onClick={() => openArtist(track)}><UserRound />Go to artist</button><button onClick={() => openAlbum(track)}><Album />Go to album</button></div>}</div>
        </div>
      ))}
      {visibleRows < tracks.length && <button className="load-more" onClick={() => setRowWindow({ key: rowWindowKey, count: visibleRows + rowBatchSize })}>Show more songs <span>{visibleRows.toLocaleString()} of {tracks.length.toLocaleString()}</span></button>}
    </div>
  )

  const content = () => {
    if (view === 'settings') return <SettingsPage library={library} updateInfo={updateInfo} checkingForUpdates={checkingForUpdates} onAddSource={addSource} onRemoveSource={removeSource} onRescan={rescan} onLibraryChange={(value) => { setLibrary(value); setSupermixHistory(value.history) }} onUpdateSettings={updateSettings} onCheckForUpdates={runUpdateCheck} />
    if (!library.tracks.length) return (
      <section className="empty-library">
        <div className="empty-symbol"><Music2 /><span><Sparkles /></span></div>
        <p className="eyebrow">Your music, in its element</p>
        <h1>Bring your library into focus.</h1>
        <p>Add a local or network folder, or connect your Jellyfin server. Polaris brings every source into one private library.</p>
        <div className="empty-library-actions"><button className="primary-button" onClick={addSource}><FolderPlus />Add folder</button><button className="secondary-button" onClick={() => showView('settings')}><Cloud />Add Jellyfin server</button></div>
        <small>FLAC, MP3, AAC, ALAC, OGG, Opus, WAV, WMA and APE</small>
      </section>
    )
    if (query) return <section className={query !== deferredQuery ? 'search-pending' : ''}><PageHeading eyebrow="Search" title={`Results for “${query}”`} subtitle={`${searchResults.matchCount} matches`} /><div className="search-tabs" role="tablist" aria-label="Search result type"><button className={searchTab === 'songs' ? 'active' : ''} onClick={() => setSearchTab('songs')}>Songs <span>{searchResults.songs.length}</span></button><button className={searchTab === 'albums' ? 'active' : ''} onClick={() => setSearchTab('albums')}>Albums <span>{searchResults.albums.length}</span></button><button className={searchTab === 'artists' ? 'active' : ''} onClick={() => setSearchTab('artists')}>Artists <span>{searchResults.artists.length}</span></button></div>{searchTab === 'songs' && <><div className="list-toolbar"><SortControl value={songSort} onChange={setSongSort} options={[{ value: 'title-asc', label: 'Title A–Z' }, { value: 'title-desc', label: 'Title Z–A' }, { value: 'artist-asc', label: 'Artist A–Z' }, { value: 'album-asc', label: 'Album A–Z' }, { value: 'newest', label: 'Recently added' }, { value: 'duration', label: 'Longest first' }]} /></div>{renderRows(searchResults.songs)}</>}{searchTab === 'albums' && <><div className="list-toolbar"><SortControl value={albumSort} onChange={setAlbumSort} options={[{ value: 'title-asc', label: 'Album A–Z' }, { value: 'title-desc', label: 'Album Z–A' }, { value: 'artist-asc', label: 'Artist A–Z' }, { value: 'year-desc', label: 'Newest first' }, { value: 'year-asc', label: 'Oldest first' }]} /></div><div className="card-grid">{searchResults.albums.map((track) => <AlbumCard key={`${track.albumArtist}-${track.album}`} track={track} onClick={() => openAlbum(track)} />)}</div></>}{searchTab === 'artists' && <><div className="list-toolbar"><SortControl value={artistSort} onChange={setArtistSort} options={[{ value: 'name-asc', label: 'Artist A–Z' }, { value: 'name-desc', label: 'Artist Z–A' }, { value: 'songs-desc', label: 'Most songs' }, { value: 'songs-asc', label: 'Fewest songs' }]} /></div><div className="artist-grid">{searchResults.artists.map((track) => { const name = track.artist || track.albumArtist; return <ArtistCard key={name} artist={name} count={artistCount(name)} onClick={() => openArtist(track, name)} /> })}</div></>}</section>
    if (view === 'supermix') return <section><div className="feature-heading"><div><p className="eyebrow">Made for your library</p><h1>Supermix</h1><p>A varied mix shaped by loved songs, favorite artists, genres, and recent listening.</p></div><div className="heading-actions"><button className="secondary-button" onClick={() => { setSupermixHistory(library.history); setSupermixVariation((value) => value + 1) }}><RefreshCw />Regenerate</button><button className="primary-button" onClick={() => supermixTracks[0] && playTrack(supermixTracks[0], supermixTracks)}><Play />Play mix</button></div></div>{renderRows(supermixTracks)}</section>
    if (view === 'playlist') {
      const playlist = library.playlists.find((item) => item.id === selectedPlaylist)
      if (!playlist) return <section><PageHeading eyebrow="Playlists" title="Choose a playlist" subtitle="Create one from the sidebar, then drag songs onto it." /></section>
      const playlistTracks = playlist.trackIds.map((id) => libraryIndex.tracksById.get(id)).filter(Boolean) as Track[]
      return <section><div className="feature-heading"><div><p className="eyebrow">Playlist</p><h1>{playlist.name}</h1><p>{playlistTracks.length} songs · Drag rows to reorder.</p></div><div className="heading-actions"><button className="secondary-button danger" onClick={() => removePlaylist(playlist.id)}><Trash2 />Delete</button><button className="primary-button" disabled={!playlistTracks.length} onClick={() => playlistTracks[0] && playTrack(playlistTracks[0], playlistTracks)}><Play />Play</button></div></div>{playlistTracks.length ? renderRows(playlistTracks, playlist.id) : <div className="empty-state"><ListMusic /><strong>This playlist is empty</strong><span>Drag songs onto its name in the sidebar or use a song’s menu.</span></div>}</section>
    }
    if (selectedAlbum) {
      const albumTracks = [...(libraryIndex.tracksByAlbum.get(`${selectedArtist}\0${selectedAlbum}`) || [])].sort((a, b) => a.disc - b.disc || a.track - b.track)
      const lead = albumTracks[0]
      return <section className="detail-page" style={{ '--detail-image': lead.artwork ? `url("${lead.artwork}")` : 'none' } as React.CSSProperties}><div className="detail-backdrop" /><div className="detail-hero"><Artwork track={lead} size="large" /><div><p className="eyebrow">Album</p><h1>{lead.album}</h1><button className="artist-link" onClick={() => openArtist(lead)}>{lead.albumArtist}</button><p>{lead.year || 'Unknown year'} · {albumTracks.length} songs · {formatTime(albumTracks.reduce((sum, item) => sum + item.duration, 0))}</p><button className="round-play" onClick={() => playTrack(lead, albumTracks)}><Play /></button></div></div>{renderRows(albumTracks)}</section>
    }
    if (selectedArtist) {
      const artistTracks = libraryIndex.tracksByArtist.get(selectedArtist) || []
      const fetchedImages = artistImage.artist === selectedArtist ? artistImage.images : { profile: '', background: '' }
      const fallbackArtwork = artistTracks.find((track) => track.artwork)?.artwork || ''
      const profileImage = fetchedImages.profile || fallbackArtwork
      const backgroundImage = fetchedImages.background || profileImage
      const artistGenres = fetchedImages.genres?.length ? fetchedImages.genres : uniqueBy(artistTracks.filter((track) => track.genre), (track) => track.genre).map((track) => track.genre)
      const recentArtistTracks = historyTracks.filter((track) => track.artist === selectedArtist || track.albumArtist === selectedArtist)
      const rankedRecordings = (fetchedImages.topRecordings || []).map((recording, apiRank) => ({ recording, apiRank })).sort((left, right) => right.recording.listeners - left.recording.listeners || right.recording.listens - left.recording.listens || left.apiRank - right.apiRank)
      const globalRanks = new Map<string, number>()
      rankedRecordings.forEach(({ recording }, rank) => titleKeys(recording.title).forEach((key) => { if (!globalRanks.has(key)) globalRanks.set(key, rank) }))
      const rankForTrack = (track: Track) => Math.min(...titleKeys(track.title).map((key) => globalRanks.get(key) ?? Number.MAX_SAFE_INTEGER))
      const fallbackArtistTracks = [...artistTracks].sort((left, right) => Number(library.favorites.includes(right.id)) - Number(library.favorites.includes(left.id)) || (library.history.indexOf(left.id) < 0 ? 999 : library.history.indexOf(left.id)) - (library.history.indexOf(right.id) < 0 ? 999 : library.history.indexOf(right.id)) || right.year - left.year || left.disc - right.disc || left.track - right.track)
      const globallyPopularLocalTracks = uniqueBy(artistTracks.filter((track) => rankForTrack(track) < Number.MAX_SAFE_INTEGER), (track) => titleKeys(track.title).at(-1) || normalizedTitle(track.title)).sort((left, right) => rankForTrack(left) - rankForTrack(right))
      const artistAlbums = uniqueBy(artistTracks, (track) => track.album).sort((left, right) => right.year - left.year || left.album.localeCompare(right.album))
      const rankedTrackIds = new Set(globallyPopularLocalTracks.map((track) => track.id))
      const localArtistTracks = [...globallyPopularLocalTracks, ...fallbackArtistTracks.filter((track) => !rankedTrackIds.has(track.id))]
      const localTrackHeading = globallyPopularLocalTracks.length ? 'Popular in your library' : 'Songs'
      return <section className="detail-page artist-detail"><div className="detail-backdrop">{backgroundImage && <img src={backgroundImage} alt="" />}</div><div className="artist-hero">{profileImage ? <div className="artist-hero-photo"><img src={profileImage} alt={`${selectedArtist} profile`} /></div> : <div className="artist-hero-photo"><UserRound /></div>}<div><p className="eyebrow">Artist</p><h1>{selectedArtist}</h1><p>{artistAlbums.length} albums · {artistTracks.length} songs · {recentArtistTracks.length} recent plays</p>{artistGenres.length ? <div className="genre-list">{artistGenres.map((genre) => <span key={genre}>{genre}</span>)}</div> : null}{fetchedImages.links?.length ? <div className="artist-links">{fetchedImages.links.map((link) => <button key={link.url} onClick={() => window.polaris?.openExternal(link.url)}>{link.label}</button>)}</div> : null}<button className="round-play heading-play" onClick={() => playTrack(artistTracks[0], artistTracks)}><Play /></button></div></div>{fetchedImages.biography && <p className="artist-biography">{fetchedImages.biography}</p>}<h2 className="section-title">{localTrackHeading}</h2>{renderRows(localArtistTracks.slice(0, 10))}{recentArtistTracks.length > 0 && <><h2 className="section-title">Recently played</h2>{renderRows(recentArtistTracks.slice(0, 8))}</>}<h2 className="section-title">Albums</h2><div className="card-grid">{artistAlbums.map((track) => <AlbumCard key={track.album} track={track} onClick={() => openAlbum(track)} />)}</div></section>
    }
    if (view === 'songs') return <section><PageHeading eyebrow="Library" title="Songs" subtitle={`${library.tracks.length.toLocaleString()} tracks`} /><div className="list-toolbar"><SortControl value={songSort} onChange={setSongSort} options={[{ value: 'title-asc', label: 'Title A–Z' }, { value: 'title-desc', label: 'Title Z–A' }, { value: 'artist-asc', label: 'Artist A–Z' }, { value: 'album-asc', label: 'Album A–Z' }, { value: 'newest', label: 'Recently added' }, { value: 'duration', label: 'Longest first' }]} /></div>{renderRows(songs)}</section>
    if (view === 'genres') {
      if (selectedGenre) { const tracks = libraryIndex.tracksByGenre.get(selectedGenre) || []; return <section><PageHeading eyebrow="Genre" title={selectedGenre} subtitle={`${tracks.length.toLocaleString()} songs`} />{renderRows(tracks)}</section> }
      return <section><PageHeading eyebrow="Discover" title="Genres" subtitle={`${libraryIndex.tracksByGenre.size.toLocaleString()} sounds in your library`} /><div className="discovery-grid">{[...libraryIndex.tracksByGenre.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([genre, tracks], index) => <button className="discovery-tile" style={{ '--tile-index': index } as React.CSSProperties} key={genre} onClick={() => { rememberLocation(); setSelectedGenre(genre) }}><Artwork track={tracks.find((track) => track.artwork) || tracks[0]} size="large" /><span><strong>{genre}</strong><small>{tracks.length} songs</small></span></button>)}</div></section>
    }
    if (view === 'decades') {
      if (selectedDecade) { const tracks = libraryIndex.tracksByDecade.get(selectedDecade) || []; return <section><PageHeading eyebrow="Decade" title={`${selectedDecade}s`} subtitle={`${tracks.length.toLocaleString()} songs`} />{renderRows(tracks)}</section> }
      return <section><PageHeading eyebrow="Discover" title="Decades" subtitle="Travel through your collection" /><div className="discovery-grid discovery-grid--decades">{[...libraryIndex.tracksByDecade.entries()].sort(([left], [right]) => right - left).map(([decade, tracks], index) => <button className="discovery-tile" style={{ '--tile-index': index } as React.CSSProperties} key={decade} onClick={() => { rememberLocation(); setSelectedDecade(decade) }}><Artwork track={tracks.find((track) => track.artwork) || tracks[0]} size="large" /><span><strong>{decade}s</strong><small>{tracks.length} songs</small></span></button>)}</div></section>
    }
    if (view === 'albums') return <section><PageHeading eyebrow="Library" title="Albums" subtitle={`${albums.length.toLocaleString()} releases`} /><div className="list-toolbar"><SortControl value={albumSort} onChange={setAlbumSort} options={[{ value: 'title-asc', label: 'Album A–Z' }, { value: 'title-desc', label: 'Album Z–A' }, { value: 'artist-asc', label: 'Artist A–Z' }, { value: 'year-desc', label: 'Newest first' }, { value: 'year-asc', label: 'Oldest first' }]} /></div><div className="card-grid">{albums.map((track) => <AlbumCard key={`${track.albumArtist}-${track.album}`} track={track} onClick={() => openAlbum(track)} />)}</div></section>
    if (view === 'artists') return <section><PageHeading eyebrow="Library" title="Artists" subtitle={`${artists.length.toLocaleString()} artists`} /><div className="list-toolbar"><SortControl value={artistSort} onChange={setArtistSort} options={[{ value: 'name-asc', label: 'Artist A–Z' }, { value: 'name-desc', label: 'Artist Z–A' }, { value: 'songs-desc', label: 'Most songs' }, { value: 'songs-asc', label: 'Fewest songs' }]} /></div><div className="artist-grid">{artists.map((track) => { const name = track.artist || track.albumArtist; return <ArtistCard key={name} artist={name} count={artistCount(name)} onClick={() => openArtist(track, name)} /> })}</div></section>
    if (view === 'favorites') return <section><PageHeading eyebrow="Collection" title="Loved Songs" subtitle={`${library.favorites.length} favorites`} />{renderRows(library.tracks.filter((track) => library.favorites.includes(track.id)))}</section>
    if (view === 'recent') return <section><PageHeading eyebrow="Listening history" title="Recently Played" subtitle="Pick up where you left off" />{renderRows(historyTracks)}</section>
    const recent = historyTracks.length ? historyTracks : library.tracks.slice(0, 8)
    return <section><div className="welcome"><div><p className="eyebrow">Your library</p><h1>Good evening.</h1><p>{library.tracks.length.toLocaleString()} songs are ready to play.</p></div><button className="round-play" onClick={() => playTrack(library.tracks[0])}><Play /></button></div><h2 className="section-title">Recently played</h2><div className="card-grid home-grid">{uniqueBy(recent, (track) => `${track.albumArtist}-${track.album}`).slice(0, 6).map((track) => <AlbumCard key={`${track.albumArtist}-${track.album}`} track={track} onClick={() => openAlbum(track)} />)}</div><h2 className="section-title">Made from your library</h2>{renderRows(library.tracks.slice(0, 8))}</section>
  }

  const displayLyrics = lyricsTrackId === current?.id ? lyrics : []
  const activeLyric = findActiveLyric(displayLyrics, elapsed)
  const lyricsLoading = Boolean(current && lyricsTrackId !== current.id)
  const lyricsUnavailable = !current || (!lyricsLoading && !displayLyrics.length)
  const seekTo = (time: number) => { if (audioRef.current) audioRef.current.currentTime = time }

  return (
    <div className={`app ${mobilePlayer ? 'mobile-player-open' : ''} ${mobilePlayer && lyricsOpen ? 'lyrics-view' : ''}`} style={{ '--accent': library.settings.accentColor, '--accent-soft': `color-mix(in srgb, ${library.settings.accentColor} 16%, transparent)` } as React.CSSProperties}>
      <audio ref={audioRef} crossOrigin="anonymous" onTimeUpdate={(event) => { const now = performance.now(); if (now - lastElapsedUpdate.current >= 250) { lastElapsedUpdate.current = now; setElapsed(event.currentTarget.currentTime) } }} onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)} onCanPlay={() => setPlaybackError('')} onError={(event) => handlePlaybackError(event.currentTarget)} onEnded={onEnded} />
      <header className="titlebar"><div className="wordmark"><img src={logoUrl} alt="" /> POLARIS</div>{(query || selectedAlbum || selectedArtist) && <IconButton className="nav-back" label="Go back" onClick={goBack}><ArrowLeft /></IconButton>}<div className="global-search"><Search /><input value={query} onChange={(event) => updateSearch(event.target.value)} placeholder="Search songs, artists, albums" />{query && <IconButton label="Clear search" onClick={() => setQuery('')}><X /></IconButton>}</div></header>
      <aside className="sidebar">
        <nav>
          <NavButton icon={<Home />} label="Home" active={view === 'home'} onClick={() => showView('home')} />
          <NavButton icon={<WandSparkles />} label="Supermix" active={view === 'supermix'} onClick={() => showView('supermix')} />
          <NavButton icon={<RefreshCw />} label="Recently Played" active={view === 'recent'} onClick={() => showView('recent')} />
          <button className="nav-heading" aria-expanded={library.settings.libraryExpanded} onClick={() => updateSettings({ libraryExpanded: !library.settings.libraryExpanded })}><span>Library</span>{library.settings.libraryExpanded ? <ChevronDown /> : <ChevronRight />}</button>
          {library.settings.libraryExpanded && <div className="library-links"><NavButton icon={<UserRound />} label="Artists" active={view === 'artists'} onClick={() => showView('artists')} /><NavButton icon={<Album />} label="Albums" active={view === 'albums'} onClick={() => showView('albums')} /><NavButton icon={<Music2 />} label="Songs" active={view === 'songs'} onClick={() => showView('songs')} /><NavButton icon={<Disc3 />} label="Genres" active={view === 'genres'} onClick={() => showView('genres')} /><NavButton icon={<Sparkles />} label="Decades" active={view === 'decades'} onClick={() => showView('decades')} /><NavButton icon={<Heart />} label="Loved Songs" active={view === 'favorites'} onClick={() => showView('favorites')} /></div>}
          <div className="playlist-heading"><p>Playlists</p></div>
          <div className="playlist-create"><input value={playlistName} onChange={(event) => setPlaylistName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') createPlaylist() }} placeholder="New playlist" aria-label="New playlist name" /><IconButton label="Create playlist" disabled={!playlistName.trim()} onClick={createPlaylist}><Plus /></IconButton></div>
          <div className="playlist-nav">{library.playlists.map((playlist) => <button key={playlist.id} className={view === 'playlist' && selectedPlaylist === playlist.id ? 'active' : ''} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addTrackToPlaylist(playlist.id, event.dataTransfer.getData('text/polaris-track')) }} onClick={() => { setSelectedPlaylist(playlist.id); showView('playlist') }}><ListMusic /><span>{playlist.name}</span><small>{playlist.trackIds.length}</small></button>)}</div>
          <NavButton icon={<SettingsIcon />} label="Settings" active={view === 'settings'} onClick={() => showView('settings')} />
        </nav>
        <div className="source-card" onClick={(event) => event.stopPropagation()}><LibraryIcon /><span><strong>{sourceCount ? `${sourceCount} music ${sourceCount === 1 ? 'source' : 'sources'}` : 'No source added'}</strong><small>{library.folders.length === 1 && !library.jellyfinServers.length ? library.folders[0] : library.jellyfinServers.length === 1 && !library.folders.length ? library.jellyfinServers[0].name : sourceCount ? `${library.tracks.length.toLocaleString()} songs indexed` : 'Choose a folder or Jellyfin server'}</small></span><IconButton label="Add music source" active={openRowMenu === 'sources'} onClick={() => setOpenRowMenu(openRowMenu === 'sources' ? '' : 'sources')}><Plus /></IconButton>{openRowMenu === 'sources' && <div className="source-menu"><button onClick={() => { setOpenRowMenu(''); addSource() }}><FolderPlus /><span><strong>Folder</strong><small>Local, mapped drive, or NAS share</small></span></button><button onClick={() => { setOpenRowMenu(''); showView('settings') }}><Cloud /><span><strong>Add Jellyfin server</strong><small>Connect with your server URL</small></span></button></div>}</div>
      </aside>
      <main className="content">{view === 'playlist' && selectedPlaylist && (renamingPlaylist ? <div className="playlist-rename-editor"><input aria-label="Playlist name" autoFocus value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') savePlaylistName(); if (event.key === 'Escape') setRenamingPlaylist(false) }} /><button className="secondary-button" onClick={savePlaylistName}>Save playlist name</button><IconButton label="Cancel rename" onClick={() => setRenamingPlaylist(false)}><X /></IconButton></div> : <button className="playlist-rename-button secondary-button" onClick={renameSelectedPlaylist}>Rename playlist</button>)}{content()}</main>
      {playbackError && <div className="playback-error"><AudioLines /><span><strong>Could not play this song</strong><small>{playbackError}</small></span><IconButton label="Dismiss" onClick={() => setPlaybackError('')}><X /></IconButton></div>}
      {updateInfo?.available && !updateDismissed && <div className="update-toast"><Download /><span><strong>Polaris {updateInfo.latestVersion} is available</strong><small>Download the latest Windows release from GitHub.</small></span><button className="primary-button" onClick={() => window.polaris?.openExternal(updateInfo.downloadUrl)}>Get update</button><IconButton label="Dismiss update" onClick={() => setUpdateDismissed(true)}><X /></IconButton></div>}
      {scan && <div className="scan-toast"><RefreshCw className="spin" /><span><strong>Reading your library</strong><small>{scan.total ? `${scan.current.toLocaleString()} of ${scan.total.toLocaleString()} tracks` : 'Finding music files…'}</small></span>{scan.total > 0 && <progress value={scan.current} max={scan.total} />}</div>}
      {(lyricsOpen || queueOpen) && !(mobilePlayer && lyricsOpen) && <aside className="right-panel"><div className="panel-header"><div className="segmented"><button className={lyricsOpen ? 'active' : ''} disabled={lyricsUnavailable} onClick={() => { setLyricsOpen(true); setQueueOpen(false) }}>Lyrics</button><button className={queueOpen ? 'active' : ''} onClick={() => { setQueueOpen(true); setLyricsOpen(false) }}>Queue</button></div><IconButton label="Close panel" onClick={() => { setLyricsOpen(false); setQueueOpen(false) }}><X /></IconButton></div>{lyricsOpen ? <LyricsDisplay contrast={library.settings.lyricsContrast} staticAutoScroll={library.settings.staticLyricsAutoScroll} onStaticAutoScrollChange={(enabled) => updateSettings({ staticLyricsAutoScroll: enabled })} lines={displayLyrics} loading={lyricsLoading} activeLine={activeLyric} elapsed={elapsed} duration={duration} onSeek={seekTo} /> : <div className="queue"><p>Up next</p>{queue.slice(queueIndex + 1).map((track, index) => <div className="queue-item" key={`${track.id}-${index}`}><button className="queue-play" onClick={() => { setQueueIndex(queueIndex + index + 1); setPlaying(true) }}><Artwork track={track} size="small" /></button><span><button onClick={() => { setQueueIndex(queueIndex + index + 1); setPlaying(true) }}><strong>{track.title}</strong></button><button onClick={() => openArtist(track)}><small>{track.artist}</small></button><button onClick={() => openAlbum(track)}><small>{track.album}</small></button></span><small>{formatTime(track.duration)}</small></div>)}</div>}</aside>}
      <div className={`now-playing ${mobilePlayer ? 'expanded' : ''}`} style={{ '--player-art': library.settings.dynamicBackground && current?.artwork ? `url("${current.artwork}")` : 'none' } as React.CSSProperties}>
        {visualizerOpen && library.settings.visualizerStyle !== 'off' && <Visualizer analyser={analyser} running={playing && !library.settings.reduceMotion} settings={library.settings} />}
        {mobilePlayer && lyricsOpen && <LyricsDisplay contrast={library.settings.lyricsContrast} staticAutoScroll={library.settings.staticLyricsAutoScroll} onStaticAutoScrollChange={(enabled) => updateSettings({ staticLyricsAutoScroll: enabled })} className="immersive-lyrics" lines={displayLyrics} loading={lyricsLoading} activeLine={activeLyric} elapsed={elapsed} duration={duration} onSeek={seekTo} onBack={() => setLyricsOpen(false)} />}
        <button className="mobile-collapse" aria-label="Close full player" onClick={() => setMobilePlayer(false)}><ChevronDown /></button>
        <div className="now-track">{current ? <><button className="now-art-button" onClick={() => setMobilePlayer(true)} aria-label="Open full player"><Artwork track={current} size="small" /></button><span><strong>{current.title}</strong><span className="now-links"><button onClick={() => openArtist(current)}>{current.artist}</button><span>·</span><button onClick={() => openAlbum(current)}>{current.album}</button></span></span><IconButton className="now-love" label={library.favorites.includes(current.id) ? 'Remove from loved songs' : 'Love song'} active={library.favorites.includes(current.id)} onClick={() => toggleFavorite(current.id)}><Heart /></IconButton></> : <><div className="artwork artwork--small"><Music2 /></div><span><strong>Nothing playing</strong><small>Choose a song from your library</small></span></>}</div>
        <div className="mobile-art"><Artwork track={current} size="large" /></div>
        <div className="player-center"><div className="transport"><IconButton label="Shuffle" active={shuffle} onClick={() => { const next = !shuffle; setShuffle(next); updateSettings({ shuffle: next }) }}><Shuffle /></IconButton><IconButton label="Previous" onClick={() => moveTrack(-1)}><SkipBack /></IconButton><button className="transport-play" onClick={() => { if (current) { if (!playing) resumeAudioGraph(); setPlaying(!playing) } else if (library.tracks[0]) playTrack(library.tracks[0]) }} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause /> : <Play />}</button><IconButton label="Next" onClick={() => moveTrack(1)}><SkipForward /></IconButton><IconButton label={`Repeat ${repeat}`} active={repeat !== 'off'} onClick={() => { const next = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off'; setRepeat(next); updateSettings({ repeat: next }) }}>{repeat === 'one' ? <Repeat1 /> : <Repeat />}</IconButton></div><div className="timeline"><span>{formatTime(elapsed)}</span><input type="range" min="0" max={duration || 1} value={elapsed} onChange={(event) => { const value = Number(event.target.value); setElapsed(value); if (audioRef.current) audioRef.current.currentTime = value }} /><span>{formatTime(duration)}</span></div></div>
        <div className="player-tools">{current && <><IconButton label="Thumbs up" active={library.liked.includes(current.id)} onClick={() => rateTrack(current.id, 'up')}><ThumbsUp /></IconButton><IconButton label="Thumbs down" active={library.disliked.includes(current.id)} onClick={() => rateTrack(current.id, 'down')}><ThumbsDown /></IconButton><div className="player-playlist-wrap"><IconButton label="Add to playlist" active={openRowMenu === 'player-playlists'} onClick={() => setOpenRowMenu(openRowMenu === 'player-playlists' ? '' : 'player-playlists')}><Plus /></IconButton>{openRowMenu === 'player-playlists' && <div className="player-playlist-menu">{library.playlists.length ? library.playlists.map((playlist) => <button key={playlist.id} onClick={() => { addTrackToPlaylist(playlist.id, current.id); setOpenRowMenu('') }}><ListMusic />{playlist.name}</button>) : <span>Create a playlist first</span>}</div>}</div></>}<IconButton label="Visualizer" active={visualizerOpen} onClick={() => { if (!visualizerOpen) { ensureAnalyser(); audioContextRef.current?.resume() }; setVisualizerOpen(!visualizerOpen) }}><SlidersHorizontal /></IconButton><IconButton label={lyricsUnavailable ? 'Lyrics unavailable' : 'Lyrics'} disabled={lyricsUnavailable} active={lyricsOpen} onClick={() => { setLyricsOpen(!lyricsOpen); setQueueOpen(false) }}><Mic2 /></IconButton><IconButton label="Queue" active={queueOpen} onClick={() => { setQueueOpen(!queueOpen); setLyricsOpen(false) }}><ListMusic /></IconButton><div className="volume">{volume === 0 ? <VolumeX /> : volume < .5 ? <Volume1 /> : <Volume2 />}<input type="range" min="0" max="1" step="0.01" value={volume} onChange={(event) => { const next = Number(event.target.value); setVolume(next); updateSettings({ volume: next }) }} /></div><IconButton label="Open full player" disabled={!current} onClick={() => setMobilePlayer(true)}><Maximize2 /></IconButton></div>
      </div>
    </div>
  )
}

function NavButton({ icon, label, active, onClick }: { icon: ReactNode; label: string; active: boolean; onClick: () => void }) {
  return <button className={active ? 'active' : ''} onClick={() => startTransition(onClick)}>{icon}<span>{label}</span></button>
}

function PageHeading({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return <div className="page-heading"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{subtitle}</p></div>
}

function SettingToggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="setting-toggle"><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>
}

function JellyfinSettings({ library, onLibraryChange }: { library: Library; onLibraryChange: (library: Library) => void }) {
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [progress, setProgress] = useState('')
  useEffect(() => window.polaris?.onJellyfinProgress((next) => setProgress(next.message)), [])
  const message = (reason: unknown) => reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Jellyfin could not complete that request.'
  const connect = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy('connect')
    setError('')
    setProgress('Preparing connection...')
    try {
      const next = await window.polaris?.connectJellyfin({ url, username, password })
      if (next) onLibraryChange(next)
      setPassword('')
    } catch (reason) { setError(message(reason)) }
    finally { setBusy(''); setProgress('') }
  }
  const refresh = async (serverId: string) => {
    setBusy(serverId)
    setError('')
    setProgress('Preparing refresh...')
    try { const next = await window.polaris?.refreshJellyfin(serverId); if (next) onLibraryChange(next) }
    catch (reason) { setError(message(reason)) }
    finally { setBusy(''); setProgress('') }
  }
  const disconnect = async (serverId: string) => {
    setBusy(serverId)
    setError('')
    try { const next = await window.polaris?.disconnectJellyfin(serverId); if (next) onLibraryChange(next) }
    catch (reason) { setError(message(reason)) }
    finally { setBusy('') }
  }
  return <div className="settings-group settings-group--jellyfin"><div className="settings-group-title"><Cloud /><span><h2>Jellyfin servers</h2><small>Stream your music from home or across the internet</small></span></div>{library.jellyfinServers.length > 0 && <div className="source-list">{library.jellyfinServers.map((server) => { const trackCount = library.tracks.filter((track) => track.sourceId === server.id).length; return <div className="source-item jellyfin-source" key={server.id}><Cloud /><span><strong>{server.name}</strong><small>{server.username} · {trackCount.toLocaleString()} songs · {server.url}</small></span><IconButton label={`Refresh ${server.name}`} disabled={Boolean(busy)} onClick={() => refresh(server.id)}><RefreshCw className={busy === server.id ? 'spin' : ''} /></IconButton><IconButton label={`Disconnect ${server.name}`} disabled={Boolean(busy)} onClick={() => disconnect(server.id)}><Trash2 /></IconButton></div> })}</div>}<form className="jellyfin-form" onSubmit={connect}><label><span>Server URL</span><input type="text" inputMode="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://music.example.com" autoComplete="url" required /></label><label><span>Username</span><input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required /></label><label><span>Password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label><button className="secondary-button" disabled={Boolean(busy)} type="submit">{busy === 'connect' ? <RefreshCw className="spin" /> : <Cloud />}Connect</button></form>{progress && <p className="jellyfin-progress" role="status"><RefreshCw className="spin" />{progress}</p>}{error && <p className="jellyfin-error" role="alert">{error}</p>}<p className="background-scan-note">Use trusted HTTPS for servers available on the internet. Passwords are never saved; the access token is encrypted by Windows.</p></div>
}

interface SettingsPageProps { library: Library; updateInfo: UpdateInfo | null; checkingForUpdates: boolean; onAddSource: () => void; onRemoveSource: (folder: string) => void; onRescan: () => void; onLibraryChange: (library: Library) => void; onUpdateSettings: (settings: Partial<Settings>) => void; onCheckForUpdates: () => Promise<void> }

function SettingsBase({ library, updateInfo, checkingForUpdates, onAddSource, onRemoveSource, onRescan, onUpdateSettings, onCheckForUpdates }: SettingsPageProps) {
  const currentVersion = updateInfo?.currentVersion || '1.0.13'
  const updateStatus = updateInfo?.available ? `Polaris ${updateInfo.latestVersion} is ready to download.` : updateInfo?.error ? 'Could not reach GitHub. Check your connection and try again.' : updateInfo ? `Polaris ${currentVersion} is up to date.` : 'Checking GitHub Releases.'
  return (
    <section className="settings-page">
      <div className="settings-heading">
        <div><p className="eyebrow">Polaris control room</p><h1>Settings</h1><p>Tune the library, playback experience, and how Polaris looks.</p></div>
        <div className="release-mark"><img src={logoUrl} alt="" /><span><small>Current release</small><strong>Polaris {currentVersion}</strong></span><button className="secondary-button" onClick={() => window.polaris?.openExternal('https://github.com/Rhigo/Polaris-Audio')}><Code2 />GitHub<ExternalLink /></button></div>
      </div>
      <div className="settings-groups">
        <div className="settings-group settings-group--sources">
          <div className="settings-group-title"><LibraryIcon /><span><h2>Music sources</h2><small>Local folders, mapped drives, and NAS shares</small></span></div>
          <div className="source-list">
            {library.folders.length ? library.folders.map((folder) => <div className="source-item" key={folder}><LibraryIcon /><span><strong>{folder.split(/[\\/]/).filter(Boolean).at(-1) || folder}</strong><small>{folder}</small></span><IconButton label={`Remove ${folder}`} onClick={() => onRemoveSource(folder)}><Trash2 /></IconButton></div>) : <div className="source-empty"><FolderPlus /><span><strong>No music sources yet</strong><small>Add a folder to begin building your library.</small></span></div>}
          </div>
          <div className="settings-source-actions"><button className="secondary-button" onClick={onAddSource}><FolderPlus />Add source</button><button className="secondary-button" disabled={!library.folders.length} onClick={onRescan}><RefreshCw />Rescan now</button></div>
          <p className="background-scan-note">File changes refresh quietly in the background. Rescan now is the only scan that shows progress.</p>
        </div>
        <div className="settings-group">
          <div className="settings-group-title"><Mic2 /><span><h2>Lyrics</h2><small>Local, embedded, and online words</small></span></div>
          <SettingToggle label="Online fallback" description="Use LRCLIB when local and embedded lyrics are unavailable." checked={library.settings.onlineLyrics} onChange={(checked) => onUpdateSettings({ onlineLyrics: checked })} />
          <label>Contrast<select value={library.settings.lyricsContrast} onChange={(event) => onUpdateSettings({ lyricsContrast: event.target.value as Settings['lyricsContrast'] })}><option value="normal">Normal</option><option value="high">High</option><option value="maximum">Maximum</option></select></label>
        </div>
        <div className="settings-group settings-group--visualizer">
          <div className="settings-group-title"><SlidersHorizontal /><span><h2>Visualizer</h2><small>Motion and audio response</small></span></div>
          <label>Style<select value={library.settings.visualizerStyle} onChange={(event) => onUpdateSettings({ visualizerStyle: event.target.value as Settings['visualizerStyle'] })}><option value="off">Off</option><option value="spectrum">Spectrum</option><option value="waveform">Waveform</option><option value="ambient">Ambient bars</option></select></label>
          <label>Intensity<input type="range" min="0.1" max="1" step="0.05" value={library.settings.visualizerIntensity} onChange={(event) => onUpdateSettings({ visualizerIntensity: Number(event.target.value) })} /></label>
          <label>Opacity<input type="range" min="0.05" max="0.6" step="0.05" value={library.settings.visualizerOpacity} onChange={(event) => onUpdateSettings({ visualizerOpacity: Number(event.target.value) })} /></label>
          <label>Color<input type="color" value={library.settings.visualizerColor} onChange={(event) => onUpdateSettings({ visualizerColor: event.target.value })} /></label>
          <SettingToggle label="Reduce motion" description="Keep visual effects restrained." checked={library.settings.reduceMotion} onChange={(checked) => onUpdateSettings({ reduceMotion: checked })} />
        </div>
        <div className="settings-group">
          <div className="settings-group-title"><Sparkles /><span><h2>Appearance</h2><small>Make Polaris feel like yours</small></span></div>
          <p>Choose the accent used for active controls and highlights.</p>
          <fieldset className="accent-picker"><legend>Accent color</legend><div>{accentPresets.map((preset) => <button key={preset.color} className={library.settings.accentColor === preset.color ? 'active' : ''} style={{ '--swatch': preset.color } as React.CSSProperties} aria-label={preset.name} title={preset.name} onClick={() => onUpdateSettings({ accentColor: preset.color })}><span /></button>)}</div></fieldset>
        </div>
        <div className="settings-group settings-group--release">
          <div className="release-copy">
            <div className="settings-group-title"><ScrollText /><span><h2>What's new in 1.0.13</h2><small>Released through GitHub</small></span></div>
            <ul><li>Cancelled Jellyfin streams close promptly</li><li>Artwork loads only as it becomes visible</li><li>Rapid artist and track changes stay responsive</li></ul>
          </div>
          <div className="update-settings"><span className={updateInfo?.available ? 'release-status release-status--available' : 'release-status'}>{updateStatus}</span><div>{updateInfo?.available && <button className="primary-button" onClick={() => window.polaris?.openExternal(updateInfo.downloadUrl)}><Download />Get version {updateInfo.latestVersion}</button>}<button className="secondary-button" disabled={checkingForUpdates} onClick={onCheckForUpdates}><RefreshCw className={checkingForUpdates ? 'spin' : ''} />{checkingForUpdates ? 'Checking' : 'Check for updates'}</button></div></div>
        </div>
      </div>
    </section>
  )
}

function SettingsPage(props: SettingsPageProps) {
  return <><SettingsBase {...props} /><section className="settings-page settings-page--remote"><div className="settings-groups settings-groups--remote"><JellyfinSettings library={props.library} onLibraryChange={props.onLibraryChange} /></div></section></>
}

function AlbumCard({ track, onClick }: { track: Track; onClick: () => void }) {
  return <article className="album-card"><button className="album-main" onClick={onClick}><div className="album-art-wrap"><Artwork track={track} size="medium" /><span className="card-play"><Play /></span></div><strong>{track.album}</strong></button><span>{track.year || 'Album'} · <button onClick={() => window.dispatchEvent(new CustomEvent('polaris:open-artist', { detail: track }))}>{track.albumArtist}</button></span></article>
}

export default App
