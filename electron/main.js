import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron'
import { createHash } from 'node:crypto'
import { createReadStream, promises as fs, watch } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import os from 'node:os'
import { parseFile, selectCover } from 'music-metadata'

const audioExtensions = new Set(['.flac', '.mp3', '.m4a', '.aac', '.ogg', '.opus', '.wav', '.wma', '.ape'])
const mediaTypes = new Map([
  ['.flac', 'audio/flac'], ['.mp3', 'audio/mpeg'], ['.m4a', 'audio/mp4'], ['.aac', 'audio/aac'],
  ['.ogg', 'audio/ogg'], ['.opus', 'audio/ogg; codecs=opus'], ['.wav', 'audio/wav'],
  ['.wma', 'audio/x-ms-wma'], ['.ape', 'audio/ape'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.png', 'image/png'],
])
let mainWindow
let artistImageCache
let lyricsCache
let lyricsFetchQueue = Promise.resolve()
let lyricsBlockedUntil = 0
let libraryRoot = ''
let activeScan = null
let queuedScanFolder = ''
let libraryWatcher
let watchTimer
let watchPoll
const artistImageRequests = new Map()
let musicBrainzQueue = Promise.resolve()
let lastMusicBrainzRequest = 0

const musicBrainzFetch = (url) => {
  const request = musicBrainzQueue.then(async () => {
    const wait = Math.max(0, 1100 - (Date.now() - lastMusicBrainzRequest))
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
    lastMusicBrainzRequest = Date.now()
    return net.fetch(url, { headers: { 'User-Agent': 'PolarisAudio/1.0 (https://github.com/Rhigo/Polaris-Audio)' }, signal: AbortSignal.timeout(8000) })
  })
  musicBrainzQueue = request.catch(() => {})
  return request
}

const socialLabel = (url) => {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    return host.split('.')[0].replace(/^./, (value) => value.toUpperCase())
  } catch { return 'Website' }
}

const externalUrl = (value) => {
  if (!value) return ''
  if (value.startsWith('//')) return `https:${value}`
  return /^https?:\/\//i.test(value) ? value : `https://${value}`
}

if (process.env.POLARIS_USER_DATA) app.setPath('userData', process.env.POLARIS_USER_DATA)

protocol.registerSchemesAsPrivileged([
  { scheme: 'polaris', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
])

const cachePath = () => path.join(app.getPath('userData'), 'library.json')
const artistCachePath = () => path.join(app.getPath('userData'), 'artist-images.json')
const lyricsCachePath = () => path.join(app.getPath('userData'), 'online-lyrics.json')
const artworkPath = () => path.join(app.getPath('userData'), 'artwork')
const mediaUrl = (filePath) => `polaris://media/${Buffer.from(filePath).toString('base64url')}`
const defaultSettings = {
  onlineLyrics: true, lyricsContrast: 'high', visualizerStyle: 'spectrum', visualizerIntensity: 0.55,
  visualizerOpacity: 0.24, visualizerColor: '#f6f3ed', reduceMotion: false, volume: 0.82, shuffle: false, repeat: 'off',
  libraryExpanded: true, dynamicBackground: true,
}

function normalizeLibrary(value = {}) {
  return {
    folder: typeof value.folder === 'string' ? value.folder : '', tracks: Array.isArray(value.tracks) ? value.tracks : [],
    history: Array.isArray(value.history) ? value.history : [], favorites: Array.isArray(value.favorites) ? value.favorites : [],
    liked: Array.isArray(value.liked) ? value.liked : [], disliked: Array.isArray(value.disliked) ? value.disliked : [],
    playlists: Array.isArray(value.playlists) ? value.playlists : [], settings: { ...defaultSettings, ...(value.settings || {}) },
  }
}

async function readCache() {
  try {
    const library = normalizeLibrary(JSON.parse(await fs.readFile(cachePath(), 'utf8')))
    libraryRoot = library.folder
    return library
  } catch {
    return normalizeLibrary()
  }
}

async function writeCache(data) {
  await fs.writeFile(cachePath(), JSON.stringify(data), 'utf8')
}

async function discoverFiles(root) {
  const found = []
  const sidecars = new Map()
  const pending = [root]
  const workers = Math.min(12, Math.max(4, os.availableParallelism?.() || 4))
  while (pending.length) {
    const directories = pending.splice(0, workers)
    const batches = await Promise.all(directories.map(async (directory) => {
      try { return { directory, entries: await fs.readdir(directory, { withFileTypes: true }) } }
      catch { return { directory, entries: [] } }
    }))
    for (const { directory, entries } of batches) {
      for (const entry of entries) {
        const fullPath = path.join(directory, entry.name)
        if (entry.isDirectory()) pending.push(fullPath)
        else if (audioExtensions.has(path.extname(entry.name).toLowerCase())) found.push(fullPath)
        else if (path.extname(entry.name).toLowerCase() === '.lrc') sidecars.set(fullPath.slice(0, -4).toLocaleLowerCase(), fullPath)
      }
    }
  }
  found.sort(comparePaths)
  return { files: found, sidecars }
}

const comparePaths = (left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
const pathKey = (filePath) => process.platform === 'win32' ? path.resolve(filePath).toLocaleLowerCase() : path.resolve(filePath)
const trackSignature = (track) => `${track.artist}\0${track.album}\0${track.title}\0${Math.round(track.duration || 0)}`.toLocaleLowerCase()

function isWithin(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function findLyrics(filePath, sidecars) {
  const base = filePath.slice(0, -path.extname(filePath).length)
  if (sidecars) return sidecars.get(base.toLocaleLowerCase()) || ''
  try { await fs.access(`${base}.lrc`); return `${base}.lrc` } catch { /* Look for alternate sidecar names. */ }
  const directory = path.dirname(filePath)
  const stem = path.basename(base).toLocaleLowerCase()
  const entries = await fs.readdir(directory)
  const exact = entries.find((entry) => path.extname(entry).toLocaleLowerCase() === '.lrc' && path.basename(entry, path.extname(entry)).toLocaleLowerCase() === stem)
  if (exact) return path.join(directory, exact)
  return ''
}

function embeddedLyrics(common) {
  const values = common.lyrics || []
  return values.map((entry) => {
    if (typeof entry === 'string') return entry
    if (entry?.syncText?.length) return entry.syncText.map(({ text, timestamp }) => {
      if (timestamp === undefined) return text
      const seconds = timestamp > 10000 ? timestamp / 1000 : timestamp
      const minutes = Math.floor(seconds / 60)
      const remainder = (seconds % 60).toFixed(2).padStart(5, '0')
      return `[${String(minutes).padStart(2, '0')}:${remainder}]${text}`
    }).join('\n')
    return entry?.text || ''
  }).filter(Boolean).join('\n')
}

async function extractTrack(filePath, index, sidecars, stats) {
  const metadata = await parseFile(filePath, { duration: true })
  const common = metadata.common
  const cover = selectCover(common.picture)
  let artwork = ''
  if (cover) {
    const extension = cover.format.includes('png') ? 'png' : 'jpg'
    const artworkFile = path.join(artworkPath(), `${createHash('sha1').update(cover.data).digest('hex')}.${extension}`)
    try { await fs.writeFile(artworkFile, cover.data, { flag: 'wx' }) } catch (error) { if (error?.code !== 'EEXIST') throw error }
    artwork = mediaUrl(artworkFile)
  }
  const fallbackTitle = path.basename(filePath, path.extname(filePath))
  return {
    id: createHash('sha1').update(filePath).digest('hex'),
    path: filePath,
    url: mediaUrl(filePath),
    title: common.title || fallbackTitle,
    artist: common.artist || common.albumartist || 'Unknown Artist',
    albumArtist: common.albumartist || common.artist || 'Unknown Artist',
    album: common.album || 'Unknown Album',
    year: common.year || 0,
    track: common.track.no || index + 1,
    disc: common.disk.no || 1,
    genre: common.genre?.[0] || '',
    duration: metadata.format.duration || 0,
    sampleRate: metadata.format.sampleRate || 0,
    bitDepth: metadata.format.bitsPerSample || 0,
    lossless: metadata.format.lossless || false,
    artwork,
    lyricPath: await findLyrics(filePath, sidecars),
    embeddedLyrics: embeddedLyrics(common),
    addedAt: Date.now(),
    fileSize: stats.size,
    modifiedAt: stats.mtimeMs,
  }
}

async function scanLibrary(folder) {
  const stats = await fs.stat(folder)
  if (!stats.isDirectory()) throw new Error('Music library path is not a directory')
  const { files, sidecars } = await discoverFiles(folder)
  await fs.mkdir(artworkPath(), { recursive: true })
  const previous = await readCache()
  const byPath = new Map(previous.tracks.map((track) => [pathKey(track.path), track]))
  const bySignature = new Map()
  for (const track of previous.tracks) {
    const signature = trackSignature(track)
    bySignature.set(signature, bySignature.has(signature) ? null : track)
  }
  const tracks = new Array(files.length)
  let cursor = 0
  let completed = 0
  const worker = async () => {
    while (cursor < files.length) {
      const index = cursor++
      const filePath = files[index]
      try {
        const cached = byPath.get(pathKey(filePath))
        const fileStats = await fs.stat(filePath)
        const unchanged = cached && (!cached.modifiedAt || (cached.modifiedAt === fileStats.mtimeMs && cached.fileSize === fileStats.size))
        tracks[index] = unchanged ? {
          ...cached,
          url: mediaUrl(filePath),
          lyricPath: await findLyrics(filePath, sidecars),
          fileSize: fileStats.size,
          modifiedAt: fileStats.mtimeMs,
        } : await extractTrack(filePath, index, sidecars, fileStats)
        if (!cached) {
          const migrated = bySignature.get(trackSignature(tracks[index]))
          if (migrated) tracks[index] = { ...tracks[index], id: migrated.id, addedAt: migrated.addedAt }
        }
      } catch (error) {
        console.warn(`Could not read metadata for ${filePath}:`, error)
      }
      completed += 1
      if (completed % 10 === 0 || completed === files.length) {
        mainWindow?.webContents.send('library:progress', { current: completed, total: files.length })
      }
    }
  }
  const processors = os.availableParallelism?.() || 4
  const metadataWorkers = Math.min(files.length, Math.max(8, Math.min(24, processors * 2)))
  await Promise.all(Array.from({ length: metadataWorkers }, worker))
  const liveIds = new Set(tracks.filter(Boolean).map((track) => track.id))
  const library = {
    folder, tracks: tracks.filter(Boolean),
    history: previous.history.filter((id) => liveIds.has(id)), favorites: previous.favorites.filter((id) => liveIds.has(id)),
    liked: previous.liked.filter((id) => liveIds.has(id)), disliked: previous.disliked.filter((id) => liveIds.has(id)),
    playlists: previous.playlists.map((playlist) => ({ ...playlist, trackIds: playlist.trackIds.filter((id) => liveIds.has(id)) })),
    settings: previous.settings,
  }
  await writeCache(library)
  libraryRoot = folder
  return library
}

function requestScan(folder) {
  if (activeScan) { queuedScanFolder = folder; return activeScan }
  activeScan = scanLibrary(folder).finally(() => {
    activeScan = null
    if (queuedScanFolder) {
      const nextFolder = queuedScanFolder
      queuedScanFolder = ''
      requestScan(nextFolder).then((library) => mainWindow?.webContents.send('library:updated', library), (error) => console.warn('Queued library refresh failed:', error))
    }
  })
  return activeScan
}

function watchLibrary(folder) {
  libraryWatcher?.close()
  clearTimeout(watchTimer)
  clearInterval(watchPoll)
  if (!folder) return
  const refresh = () => {
    clearTimeout(watchTimer)
    watchTimer = setTimeout(async () => {
      try {
        const library = await requestScan(folder)
        mainWindow?.webContents.send('library:updated', library)
      } catch (error) { console.warn('Automatic library refresh failed:', error) }
    }, 2500)
  }
  try {
    libraryWatcher = watch(folder, { recursive: true }, (_event, filename) => {
      if (filename && !audioExtensions.has(path.extname(filename).toLowerCase()) && path.extname(filename).toLowerCase() !== '.lrc') return
      refresh()
    })
  } catch (error) { console.warn('Could not watch music library:', error) }
  watchPoll = setInterval(refresh, 5 * 60 * 1000)
  watchPoll.unref?.()
}

function parseLyrics(content) {
  const lines = []
  for (const raw of content.split(/\r?\n/)) {
    const matches = [...raw.matchAll(/\[(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\]/g)]
    const text = raw.replace(/\[[^\]]+\]/g, '').trim()
    if (matches.length && text) {
      for (const match of matches) lines.push({ time: Number(match[1]) * 60 + Number(match[2]), text })
    } else if (text && !/^\[[a-z]+:/i.test(raw)) {
      lines.push({ time: null, text })
    }
  }
  return lines.sort((a, b) => (a.time ?? Number.MAX_VALUE) - (b.time ?? Number.MAX_VALUE))
}

async function onlineLyrics(track) {
  if (!track?.title || !track?.artist || track.artist === 'Unknown Artist' || Date.now() < lyricsBlockedUntil) return []
  if (!lyricsCache) {
    try { lyricsCache = JSON.parse(await fs.readFile(lyricsCachePath(), 'utf8')) } catch { lyricsCache = {} }
  }
  const cacheKey = createHash('sha1').update(`${track.artist}\0${track.title}\0${track.album || ''}\0${Math.round(track.duration || 0)}`).digest('hex')
  const cached = lyricsCache[cacheKey]
  const maxAge = cached?.content ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000
  if (cached && Date.now() - cached.cachedAt < maxAge) return parseLyrics(cached.content)

  const request = lyricsFetchQueue.then(async () => {
    const baseUrl = process.env.LRCLIB_API_URL || 'https://lrclib.net/api/get'
    const url = new URL(baseUrl)
    url.searchParams.set('artist_name', track.artist)
    url.searchParams.set('track_name', track.title)
    if (track.album) url.searchParams.set('album_name', track.album)
    if (track.duration >= 1 && track.duration <= 3600) url.searchParams.set('duration', String(Math.round(track.duration)))
    try {
      const response = await net.fetch(url.toString(), {
        headers: { 'User-Agent': `Polaris/${app.getVersion()} (personal desktop music player)` },
        signal: AbortSignal.timeout(7000),
      })
      if (response.status === 429) {
        lyricsBlockedUntil = Date.now() + Math.max(1, Number(response.headers.get('retry-after')) || 60) * 1000
        return []
      }
      const data = response.ok ? await response.json() : {}
      const content = data.instrumental ? '' : data.syncedLyrics || data.plainLyrics || ''
      lyricsCache[cacheKey] = { content, cachedAt: Date.now() }
      await fs.writeFile(lyricsCachePath(), JSON.stringify(lyricsCache), 'utf8')
      return parseLyrics(content)
    } catch { return [] }
  })
  lyricsFetchQueue = request.then(() => undefined, () => undefined)
  return request
}

async function mediaResponse(request) {
  let filePath
  let stats
  try {
    const token = new URL(request.url).pathname.slice(1)
    filePath = await fs.realpath(Buffer.from(token, 'base64url').toString())
    const allowedRoots = [libraryRoot, artworkPath()].filter(Boolean)
    const canonicalRoots = await Promise.all(allowedRoots.map((root) => fs.realpath(root).catch(() => '')))
    if (!canonicalRoots.some((root) => root && isWithin(root, filePath))) throw new Error('Path is outside the media library')
    stats = await fs.stat(filePath)
    if (!stats.isFile()) throw new Error('Not a file')
  } catch {
    return new Response(null, { status: 404 })
  }
  const type = mediaTypes.get(path.extname(filePath).toLocaleLowerCase()) || 'application/octet-stream'
  const range = request.headers.get('range')
  let start = 0
  let end = stats.size - 1
  let status = 200

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (!match) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stats.size}` } })
    if (!match[1] && match[2]) {
      start = Math.max(0, stats.size - Number(match[2]))
    } else {
      start = match[1] ? Number(match[1]) : 0
      end = match[2] ? Math.min(Number(match[2]), stats.size - 1) : stats.size - 1
    }
    if (start > end || start >= stats.size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stats.size}` } })
    status = 206
  }

  const headers = {
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    'Content-Length': String(end - start + 1),
    'Content-Type': type,
    ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${stats.size}` } : {}),
  }
  if (request.method === 'HEAD') return new Response(null, { status, headers })
  const stream = createReadStream(filePath, { start, end })
  return new Response(Readable.toWeb(stream), { status, headers })
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 390,
    minHeight: 620,
    backgroundColor: '#0b0b0c',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0b0b0c', symbolColor: '#f4f2ef', height: 42 },
    webPreferences: {
      preload: path.join(app.getAppPath(), 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  if (process.env.VITE_DEV_SERVER_URL) await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  else if (!app.isPackaged) await mainWindow.loadURL('http://localhost:5173')
  else await mainWindow.loadFile(path.join(app.getAppPath(), 'build', 'index.html'))
}

app.whenReady().then(async () => {
  await readCache()
  watchLibrary(libraryRoot)
  protocol.handle('polaris', mediaResponse)
  ipcMain.handle('library:get', readCache)
  ipcMain.handle('library:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: 'Choose your music folder' })
    if (result.canceled) return null
    const library = await requestScan(result.filePaths[0])
    watchLibrary(library.folder)
    return library
  })
  ipcMain.handle('library:rescan', async (_, folder) => {
    const library = await readCache()
    return folder && path.resolve(folder) === path.resolve(library.folder) ? requestScan(folder) : library
  })
  ipcMain.handle('library:save-state', async (_, state) => {
    const library = await readCache()
    const allowed = {}
    for (const key of ['history', 'favorites', 'liked', 'disliked', 'playlists', 'settings']) if (state && key in state) allowed[key] = state[key]
    await writeCache(normalizeLibrary({ ...library, ...allowed }))
  })
  ipcMain.handle('lyrics:get', async (_, lyricPath, embedded, trackPath, track) => {
    try {
      const resolvedPath = lyricPath || (trackPath ? await findLyrics(trackPath) : '')
      const content = resolvedPath ? await fs.readFile(resolvedPath, 'utf8') : embedded || ''
      const localLyrics = parseLyrics(content.replace(/^\uFEFF/, ''))
      if (localLyrics.length) return localLyrics
      return (await readCache()).settings.onlineLyrics ? onlineLyrics(track) : []
    } catch {
      const embeddedLyrics = parseLyrics(embedded || '')
      if (embeddedLyrics.length) return embeddedLyrics
      return (await readCache()).settings.onlineLyrics ? onlineLyrics(track) : []
    }
  })
  ipcMain.handle('external:open', (_, url) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false
    return shell.openExternal(url).then(() => true, () => false)
  })
  ipcMain.handle('artist:image', async (_, artist) => {
    if (artistImageRequests.has(artist)) return artistImageRequests.get(artist)
    const request = (async () => {
    try {
      if (!artistImageCache) {
        try { artistImageCache = JSON.parse(await fs.readFile(artistCachePath(), 'utf8')) } catch { artistImageCache = {} }
        const oldest = Date.now() - 90 * 24 * 60 * 60 * 1000
        artistImageCache = Object.fromEntries(Object.entries(artistImageCache).filter(([, value]) => typeof value === 'object' && value.cachedAt >= oldest).sort(([, left], [, right]) => right.cachedAt - left.cachedAt).slice(0, 5000))
      }
      const cached = artistImageCache[artist]
      if (cached && typeof cached !== 'string' && Date.now() - cached.cachedAt < 30 * 24 * 60 * 60 * 1000) return cached

      const audioDbUrl = `${process.env.AUDIODB_API_URL || 'https://www.theaudiodb.com/api/v1/json/123/search.php'}?s=${encodeURIComponent(artist)}`
      const audioDbResponse = await net.fetch(audioDbUrl, { signal: AbortSignal.timeout(6000) })
      const audioDbData = audioDbResponse.ok ? await audioDbResponse.json() : {}
      const match = audioDbData.artists?.[0]
      let profile = match?.strArtistThumb || ''
      let background = match?.strArtistFanart || match?.strArtistFanart2 || match?.strArtistWideThumb || profile
      const biography = match?.strBiographyEN || ''
      const genres = [...new Set([match?.strGenre, match?.strStyle, match?.strMood].filter(Boolean))]
      let mbid = match?.strMusicBrainzID || match?.idArtistMusicBrainz || ''
      const audioDbUrls = [match?.strWebsite, match?.strFacebook, match?.strTwitter].map(externalUrl).filter(Boolean)
      let links = audioDbUrls.map((url) => ({ label: socialLabel(url), url }))

      if (!mbid) {
        const searchUrl = `${process.env.MUSICBRAINZ_API_URL || 'https://musicbrainz.org/ws/2'}/artist/?query=${encodeURIComponent(`artist:${artist}`)}&limit=3&fmt=json`
        const searchResponse = await musicBrainzFetch(searchUrl)
        const searchData = searchResponse.ok ? await searchResponse.json() : {}
        mbid = searchData.artists?.[0]?.id || ''
      }
      if (mbid) {
        const relationResponse = await musicBrainzFetch(`${process.env.MUSICBRAINZ_API_URL || 'https://musicbrainz.org/ws/2'}/artist/${encodeURIComponent(mbid)}?inc=url-rels&fmt=json`)
        const relationData = relationResponse.ok ? await relationResponse.json() : {}
        const relationLinks = (relationData.relations || []).map((relation) => relation.url?.resource).filter((url) => /^https?:\/\//i.test(url)).map((url) => ({ label: socialLabel(url), url }))
        links = [...new Map([...links, ...relationLinks].map((link) => [link.url, link])).values()].slice(0, 8)
      }

      let topRecordings = []
      if (mbid) {
        const popularityResponse = await net.fetch(`${process.env.LISTENBRAINZ_API_URL || 'https://api.listenbrainz.org/1'}/popularity/top-recordings-for-artist/${encodeURIComponent(mbid)}`, { signal: AbortSignal.timeout(8000) })
        const popularityData = popularityResponse.ok ? await popularityResponse.json() : {}
        const candidateRecordings = popularityData.recordings || popularityData.payload?.recordings
        const recordings = Array.isArray(candidateRecordings) ? candidateRecordings : []
        topRecordings = recordings.map((recording) => ({ title: recording.recording_name || recording.title || '', listens: recording.listen_count || recording.total_listen_count || 0, listeners: recording.listener_count || recording.total_user_count || 0 })).filter((recording) => recording.title).slice(0, 100)
      }

      if (!profile && !background) {
        const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(artist + ' musician')}&gsrlimit=1&prop=pageimages&pithumbsize=900&format=json&origin=*`
        const wikiResponse = await net.fetch(wikiUrl, { signal: AbortSignal.timeout(6000) })
        const wikiData = wikiResponse.ok ? await wikiResponse.json() : {}
        profile = Object.values(wikiData.query?.pages || {})[0]?.thumbnail?.source || ''
        background = profile
      }

      const images = { profile, background, biography, genres, links, topRecordings, cachedAt: Date.now() }
      artistImageCache[artist] = images
      await fs.writeFile(artistCachePath(), JSON.stringify(artistImageCache), 'utf8')
      return images
    } catch { return { profile: '', background: '', cachedAt: Date.now() } }
    })()
    artistImageRequests.set(artist, request)
    request.finally(() => artistImageRequests.delete(artist))
    return request
  })
  await createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})