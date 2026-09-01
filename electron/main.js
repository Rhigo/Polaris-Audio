import { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage, shell } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs, watch } from 'node:fs'
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
let libraryRoots = []
let scanQueue = Promise.resolve()
let libraryWatchers = []
let watchTimer
let watchPoll
let cacheWriteQueue = Promise.resolve()
let jellyfinAccessPromise
const artistImageRequests = new Map()
let musicBrainzQueue = Promise.resolve()
let lastMusicBrainzRequest = 0

process.on('uncaughtException', (error) => {
  const watcherFailure = error?.syscall === 'watch' || error?.stack?.includes('node:internal/fs/watchers')
  if (watcherFailure) {
    console.warn('Music library watcher failed; periodic refresh remains active:', error)
    for (const watcher of libraryWatchers) watcher.close()
    libraryWatchers = []
    return
  }
  console.error('Uncaught main-process error:', error)
  app.exit(1)
})

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
  if (typeof value !== 'string' || !value.trim() || /^(?:0|null|none|n\/a|-)$/i.test(value.trim())) return ''
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : /^https?:\/\//i.test(value) ? value : `https://${value}`)
    const host = url.hostname.toLowerCase()
    const privateHost = host === '0' || host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)
    return privateHost || !['http:', 'https:'].includes(url.protocol) ? '' : url.href
  } catch { return '' }
}

const normalizedArtistName = (value = '') => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim()
const exactArtistMatch = (candidate, requested) => normalizedArtistName(candidate) === normalizedArtistName(requested)
const catalogArtistMatch = (candidate = '', requested = '') => candidate.split(/\s*(?:&|,|feat(?:uring)?|ft\.)\s*/i).some((name) => exactArtistMatch(name, requested))
const wikipediaArtistMatch = (candidate, requested) => exactArtistMatch(candidate?.replace(/\s*\((?:band|musician|rapper|singer|group|artist|dj)\)\s*$/i, ''), requested)
const releasesUrl = 'https://github.com/Rhigo/Polaris-Audio/releases'
const artistRankingVersion = 4

function versionParts(value = '') {
  const match = String(value).trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/)
  return match ? match.slice(1).map(Number) : null
}

function isNewerVersion(candidate, current) {
  const candidateParts = versionParts(candidate)
  const currentParts = versionParts(current)
  if (!candidateParts || !currentParts) return false
  for (let index = 0; index < 3; index += 1) {
    if (candidateParts[index] !== currentParts[index]) return candidateParts[index] > currentParts[index]
  }
  return false
}

async function checkForUpdates() {
  const currentVersion = app.getVersion()
  try {
    const apiUrl = process.env.POLARIS_UPDATE_API_URL || 'https://api.github.com/repos/Rhigo/Polaris-Audio/releases/latest'
    const response = await net.fetch(apiUrl, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Polaris/${currentVersion}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`)
    const release = await response.json()
    const latestVersion = String(release.tag_name || '').replace(/^v/i, '')
    const assets = Array.isArray(release.assets) ? release.assets : []
    const asset = assets.find((item) => /Polaris-.*-Setup\.exe$/i.test(item?.name || '')) || assets.find((item) => /Polaris-.*-Portable\.exe$/i.test(item?.name || ''))
    const releaseUrl = /^https:\/\/github\.com\/Rhigo\/Polaris-Audio\/releases\//i.test(release.html_url || '') ? release.html_url : releasesUrl
    const downloadUrl = /^https:\/\/github\.com\/Rhigo\/Polaris-Audio\/releases\/download\//i.test(asset?.browser_download_url || '') ? asset.browser_download_url : releaseUrl
    return { currentVersion, latestVersion, available: isNewerVersion(latestVersion, currentVersion), releaseUrl, downloadUrl, checkedAt: Date.now() }
  } catch (error) {
    return { currentVersion, latestVersion: '', available: false, releaseUrl: releasesUrl, downloadUrl: releasesUrl, checkedAt: Date.now(), error: error instanceof Error ? error.message : 'Update check failed' }
  }
}

if (process.env.POLARIS_USER_DATA) app.setPath('userData', process.env.POLARIS_USER_DATA)
if (process.platform === 'win32' && !process.env.POLARIS_USER_DATA) app.setAppUserModelId('com.polaris.music')

if (!process.env.POLARIS_USER_DATA) {
  if (!app.requestSingleInstanceLock()) app.exit(0)
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'polaris', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
])

const cachePath = () => path.join(app.getPath('userData'), 'library.json')
const artistCachePath = () => path.join(app.getPath('userData'), 'artist-images.json')
const lyricsCachePath = () => path.join(app.getPath('userData'), 'online-lyrics.json')
const jellyfinCredentialsPath = () => path.join(app.getPath('userData'), 'jellyfin-credentials.json')
const artworkPath = () => path.join(app.getPath('userData'), 'artwork')
const mediaUrl = (filePath) => `polaris://media/${Buffer.from(filePath).toString('base64url')}`
const defaultSettings = {
  onlineLyrics: true, staticLyricsAutoScroll: true, lyricsContrast: 'high', visualizerStyle: 'spectrum', visualizerIntensity: 0.55,
  visualizerOpacity: 0.24, visualizerColor: '#f6f3ed', reduceMotion: false, volume: 0.82, shuffle: false, repeat: 'off',
  libraryExpanded: true, dynamicBackground: true, accentColor: '#6832c2',
}
const accentColors = new Set(['#6832c2', '#f0504d', '#e04787', '#197f8c', '#2f73c9', '#3d8b61', '#c27b28'])

function normalizeLibrary(value = {}) {
  const settings = { ...defaultSettings, ...(value.settings || {}) }
  if (!accentColors.has(settings.accentColor)) settings.accentColor = defaultSettings.accentColor
  const legacyFolder = typeof value.folder === 'string' ? value.folder : ''
  const folders = [...new Set((Array.isArray(value.folders) ? value.folders : [legacyFolder]).filter((folder) => typeof folder === 'string' && folder.trim()).map((folder) => path.resolve(folder)))]
  const jellyfinServers = (Array.isArray(value.jellyfinServers) ? value.jellyfinServers : []).filter((server) => server && typeof server.id === 'string' && typeof server.url === 'string').map((server) => ({
    id: server.id, url: server.url, name: typeof server.name === 'string' ? server.name : server.url,
    username: typeof server.username === 'string' ? server.username : '', userId: typeof server.userId === 'string' ? server.userId : '',
    lastSyncedAt: Number(server.lastSyncedAt) || 0,
  }))
  return {
    folders, folder: folders[0] || '', tracks: Array.isArray(value.tracks) ? value.tracks : [],
    history: Array.isArray(value.history) ? value.history : [], favorites: Array.isArray(value.favorites) ? value.favorites : [],
    liked: Array.isArray(value.liked) ? value.liked : [], disliked: Array.isArray(value.disliked) ? value.disliked : [],
    playlists: Array.isArray(value.playlists) ? value.playlists : [], jellyfinServers, settings,
  }
}

async function readCache() {
  try {
    const library = normalizeLibrary(JSON.parse(await fs.readFile(cachePath(), 'utf8')))
    libraryRoots = library.folders
    return library
  } catch {
    return normalizeLibrary()
  }
}

async function writeCache(data) {
  await fs.writeFile(cachePath(), JSON.stringify(data), 'utf8')
}

function updateCache(update) {
  const operation = cacheWriteQueue.then(async () => {
    const current = await readCache()
    const next = normalizeLibrary(await update(current))
    await writeCache(next)
    return next
  })
  cacheWriteQueue = operation.then(() => undefined, () => undefined)
  return operation
}

function normalizeJellyfinUrl(value) {
  const input = String(value || '').trim()
  if (!input) throw new Error('Enter your Jellyfin server URL.')
  const localAddress = /^(?:localhost|127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|[^.]+(?::\d+)?$)/i.test(input)
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `${localAddress ? 'http' : 'https'}://${input}`
  let url
  try { url = new URL(withProtocol) } catch { throw new Error('Enter a valid Jellyfin server URL.') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Jellyfin URLs must use HTTP or HTTPS without embedded credentials.')
  url.search = ''
  url.hash = ''
  return url.href.replace(/\/$/, '')
}

const jellyfinHeaderValue = (value) => String(value || '').replace(/["\\]/g, '')
const jellyfinAuthorization = (deviceId, token = '') => {
  const fields = [`MediaBrowser Client="Polaris"`, `Device="Windows Desktop"`, `DeviceId="${jellyfinHeaderValue(deviceId)}"`, `Version="${jellyfinHeaderValue(app.getVersion())}"`]
  if (token) fields.push(`Token="${jellyfinHeaderValue(token)}"`)
  return fields.join(', ')
}

async function readJellyfinCredentials() {
  try { return JSON.parse(await fs.readFile(jellyfinCredentialsPath(), 'utf8')) }
  catch { return {} }
}

async function writeJellyfinCredentials(credentials) {
  await fs.writeFile(jellyfinCredentialsPath(), JSON.stringify(credentials), { encoding: 'utf8', mode: 0o600 })
}

function resetJellyfinAccess() {
  jellyfinAccessPromise = undefined
}

async function jellyfinAccess(serverId) {
  if (!jellyfinAccessPromise) {
    jellyfinAccessPromise = Promise.all([readCache(), readJellyfinCredentials()]).then(([library, credentials]) => new Map(
      library.jellyfinServers.map((server) => [server.id, { server, credential: credentials[server.id] }]),
    )).catch((error) => {
      jellyfinAccessPromise = undefined
      throw error
    })
  }
  return (await jellyfinAccessPromise).get(serverId)
}

function encryptJellyfinToken(token) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable on this computer.')
  return safeStorage.encryptString(token).toString('base64')
}

function decryptJellyfinToken(value) {
  if (!value || !safeStorage.isEncryptionAvailable()) throw new Error('Reconnect this Jellyfin server to restore secure access.')
  return safeStorage.decryptString(Buffer.from(value, 'base64'))
}

async function jellyfinFetch(server, credential, endpoint, options = {}, timeout = 8000) {
  const token = credential.encryptedToken ? decryptJellyfinToken(credential.encryptedToken) : ''
  const headers = new Headers(options.headers || {})
  headers.set('Accept', 'application/json')
  headers.set('Authorization', jellyfinAuthorization(credential.deviceId, token))
  const requestOptions = { ...options, headers }
  if (timeout) requestOptions.signal = AbortSignal.timeout(timeout)
  return net.fetch(`${server.url}${endpoint}`, requestOptions)
}

async function jellyfinJsonRequest(server, credential, endpoint, options, timeout) {
  const controller = new AbortController()
  let timeoutId
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort()
      reject(new Error('Jellyfin took too long to respond. Check the server, then try Refresh.'))
    }, timeout)
  })
  const request = (async () => {
    const response = await jellyfinFetch(server, credential, endpoint, { ...options, signal: controller.signal }, 0)
    const text = await response.text()
    let data = {}
    try { data = text ? JSON.parse(text) : {} } catch { /* Error responses may be plain text. */ }
    return { ok: response.ok, status: response.status, data }
  })()
  try { return await Promise.race([request, timeoutPromise]) }
  finally { clearTimeout(timeoutId) }
}

const retryableJellyfinStatuses = new Set([408, 425, 429, 500, 502, 503, 504])

async function jellyfinJson(server, credential, endpoint, options = {}, timeout = 30000, retries = 0) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await jellyfinJsonRequest(server, credential, endpoint, options, timeout)
      if (!retryableJellyfinStatuses.has(response.status) || attempt >= retries) return response
    } catch (error) {
      if (attempt >= retries) throw error
    }
    sendJellyfinProgress(`Jellyfin paused. Retrying (${attempt + 1} of ${retries})...`)
    await new Promise((resolve) => setTimeout(resolve, Math.min(2000, 300 * (2 ** attempt))))
  }
}

const sendJellyfinProgress = (message, current = 0, total = 0) => mainWindow?.webContents.send('jellyfin:progress', { message, current, total })

const jellyfinAudioUrl = (serverId, itemId, mediaSourceId) => `polaris://jellyfin/audio/${encodeURIComponent(serverId)}/${encodeURIComponent(itemId)}/${encodeURIComponent(mediaSourceId || '')}`
const jellyfinArtworkUrl = (serverId, itemId, fallbackItemId) => `polaris://jellyfin/image/${encodeURIComponent(serverId)}/${encodeURIComponent(itemId)}/${encodeURIComponent(fallbackItemId || '')}`
const jellyfinLyricsPath = (serverId, itemId) => `jellyfin://lyrics/${encodeURIComponent(serverId)}/${encodeURIComponent(itemId)}`

function jellyfinTrack(server, item, previous) {
  const mediaSource = item.MediaSources?.[0] || {}
  const audioStream = mediaSource.MediaStreams?.find((stream) => stream.Type === 'Audio') || item.MediaStreams?.find((stream) => stream.Type === 'Audio') || {}
  const container = String(mediaSource.Container || item.Container || '').toLowerCase()
  const albumArtist = item.AlbumArtist || item.AlbumArtists?.[0]?.Name || item.Artists?.[0] || 'Unknown Artist'
  const artist = item.Artists?.[0] || albumArtist
  const hasItemArtwork = Boolean(item.ImageTags?.Primary || item.PrimaryImageTag)
  const imageItemId = hasItemArtwork ? item.Id : item.PrimaryImageItemId || item.AlbumId || item.Id
  const fallbackImageItemId = imageItemId !== item.AlbumId ? item.AlbumId : ''
  const hasArtwork = Boolean(item.ImageTags?.Primary || item.PrimaryImageTag || item.PrimaryImageItemId || item.AlbumId)
  return {
    id: `jellyfin:${server.id}:${item.Id}`, path: `jellyfin://${server.id}/${item.Id}`, url: jellyfinAudioUrl(server.id, item.Id, mediaSource.Id),
    title: item.Name || 'Unknown Title', artist, albumArtist, album: item.Album || 'Unknown Album',
    year: Number(item.ProductionYear) || 0, track: Number(item.IndexNumber) || 0, disc: Number(item.ParentIndexNumber) || 1,
    genre: item.Genres?.[0] || '', duration: Number(item.RunTimeTicks) / 10000000 || 0,
    sampleRate: Number(audioStream.SampleRate) || 0, bitDepth: Number(audioStream.BitDepth) || 0,
    lossless: ['flac', 'alac', 'wav', 'ape'].some((format) => container.split(',').includes(format)),
    artwork: hasArtwork ? jellyfinArtworkUrl(server.id, imageItemId, fallbackImageItemId) : '', lyricPath: jellyfinLyricsPath(server.id, item.Id), embeddedLyrics: '',
    addedAt: previous?.addedAt || Date.parse(item.DateCreated || '') || Date.now(), fileSize: Number(mediaSource.Size) || undefined,
    sourceType: 'jellyfin', sourceId: server.id, remoteId: item.Id,
  }
}

async function syncJellyfinServer(serverId) {
  const [library, credentials] = await Promise.all([readCache(), readJellyfinCredentials()])
  const server = library.jellyfinServers.find((candidate) => candidate.id === serverId)
  const credential = credentials[serverId]
  if (!server || !credential) throw new Error('Reconnect this Jellyfin server before refreshing it.')
  const existing = new Map(library.tracks.filter((track) => track.sourceType === 'jellyfin' && track.sourceId === serverId).map((track) => [track.remoteId, track]))
  const items = []
  const pageSize = 200
  sendJellyfinProgress('Loading music from Jellyfin...')
  for (let startIndex = 0; ; startIndex += pageSize) {
    const query = new URLSearchParams({
      UserId: server.userId, Recursive: 'true', IncludeItemTypes: 'Audio', Fields: 'Genres,DateCreated,MediaSources,MediaStreams,PrimaryImageAspectRatio',
      EnableImages: 'true', ImageTypeLimit: '1', SortBy: 'SortName', SortOrder: 'Ascending', StartIndex: String(startIndex), Limit: String(pageSize),
    })
    const response = await jellyfinJson(server, credential, `/Items?${query}`, {}, 30000, 2)
    if (!response.ok) throw new Error(response.status === 401 ? 'Your Jellyfin session has expired. Reconnect the server.' : `Jellyfin returned ${response.status} while loading music.`)
    const page = response.data
    const pageItems = Array.isArray(page.Items) ? page.Items : []
    items.push(...pageItems)
    const total = Number(page.TotalRecordCount || items.length)
    sendJellyfinProgress(`Loaded ${items.length.toLocaleString()} of ${total.toLocaleString()} songs`, items.length, total)
    if (pageItems.length < pageSize || items.length >= Number(page.TotalRecordCount || 0)) break
  }
  sendJellyfinProgress('Saving Jellyfin library...', items.length, items.length)
  const remoteTracks = items.map((item) => jellyfinTrack(server, item, existing.get(item.Id)))
  const syncedAt = Date.now()
  const next = await updateCache((latest) => ({
    ...latest,
    tracks: [...latest.tracks.filter((track) => track.sourceType !== 'jellyfin' || track.sourceId !== serverId), ...remoteTracks],
    jellyfinServers: latest.jellyfinServers.map((candidate) => candidate.id === serverId ? { ...candidate, lastSyncedAt: syncedAt } : candidate),
  }))
  mainWindow?.webContents.send('library:updated', next)
  return next
}

async function connectJellyfin({ url, username, password } = {}) {
  const serverUrl = normalizeJellyfinUrl(url)
  const deviceId = randomUUID()
  const server = { url: serverUrl }
  sendJellyfinProgress('Contacting Jellyfin server...')
  let publicResponse
  try { publicResponse = await jellyfinJson(server, { deviceId }, '/System/Info/Public', {}, 15000, 2) }
  catch { throw new Error('Could not reach this Jellyfin server. Check the URL and connection, then try Connect again.') }
  if (!publicResponse.ok) throw new Error(`Could not identify a Jellyfin server at this URL (${publicResponse.status}).`)
  const publicInfo = publicResponse.data
  sendJellyfinProgress('Signing in to Jellyfin...')
  let authResponse
  try {
    authResponse = await jellyfinJson(server, { deviceId }, '/Users/AuthenticateByName', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Username: String(username || '').trim(), Pw: String(password || '') }),
    })
  } catch { throw new Error('Jellyfin did not complete sign-in. Check the server, then try Connect again.') }
  if (!authResponse.ok) throw new Error(authResponse.status === 401 ? 'Jellyfin rejected that username or password.' : `Jellyfin sign-in failed (${authResponse.status}).`)
  const authentication = authResponse.data
  if (!authentication.AccessToken || !authentication.User?.Id) throw new Error('Jellyfin returned an incomplete sign-in response.')
  const id = createHash('sha1').update(`${serverUrl}\0${authentication.User.Id}`).digest('hex')
  const credentials = await readJellyfinCredentials()
  credentials[id] = { deviceId, encryptedToken: encryptJellyfinToken(authentication.AccessToken) }
  await writeJellyfinCredentials(credentials)
  const connectedLibrary = await updateCache((library) => ({
    ...library,
    jellyfinServers: [...library.jellyfinServers.filter((candidate) => candidate.id !== id), {
      id, url: serverUrl, name: publicInfo.ServerName || new URL(serverUrl).hostname,
      username: authentication.User.Name || String(username || '').trim(), userId: authentication.User.Id, lastSyncedAt: 0,
    }],
  }))
  resetJellyfinAccess()
  mainWindow?.webContents.send('library:updated', connectedLibrary)
  return syncJellyfinServer(id)
}

async function disconnectJellyfin(serverId) {
  const credentials = await readJellyfinCredentials()
  delete credentials[serverId]
  await writeJellyfinCredentials(credentials)
  const next = await updateCache((library) => {
    const tracks = library.tracks.filter((track) => track.sourceType !== 'jellyfin' || track.sourceId !== serverId)
    const liveIds = new Set(tracks.map((track) => track.id))
    return {
      ...library, tracks, jellyfinServers: library.jellyfinServers.filter((server) => server.id !== serverId),
      history: library.history.filter((id) => liveIds.has(id)), favorites: library.favorites.filter((id) => liveIds.has(id)),
      liked: library.liked.filter((id) => liveIds.has(id)), disliked: library.disliked.filter((id) => liveIds.has(id)),
      playlists: library.playlists.map((playlist) => ({ ...playlist, trackIds: playlist.trackIds.filter((id) => liveIds.has(id)) })),
    }
  })
  resetJellyfinAccess()
  mainWindow?.webContents.send('library:updated', next)
  return next
}

async function discoverFiles(root) {
  const found = []
  const sidecars = new Map()
  const unavailableDirectories = []
  const pending = [root]
  const workers = Math.min(32, Math.max(8, os.availableParallelism?.() || 4))
  while (pending.length) {
    const directories = pending.splice(0, workers)
    const batches = await Promise.all(directories.map(async (directory) => {
      try { return { directory, entries: await retryTransient(() => fs.readdir(directory, { withFileTypes: true })) } }
      catch { return { directory, entries: [], unavailable: true } }
    }))
    for (const { directory, entries, unavailable } of batches) {
      if (unavailable) unavailableDirectories.push(directory)
      for (const entry of entries) {
        const fullPath = path.join(directory, entry.name)
        if (entry.isDirectory()) pending.push(fullPath)
        else if (audioExtensions.has(path.extname(entry.name).toLowerCase())) found.push(fullPath)
        else if (path.extname(entry.name).toLowerCase() === '.lrc') sidecars.set(fullPath.slice(0, -4).toLocaleLowerCase(), fullPath)
      }
    }
  }
  found.sort(comparePaths)
  return { files: found, sidecars, unavailableDirectories }
}

const comparePaths = (left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
const pathKey = (filePath) => process.platform === 'win32' ? path.resolve(filePath).toLocaleLowerCase() : path.resolve(filePath)
const trackSignature = (track) => `${track.artist}\0${track.album}\0${track.title}\0${Math.round(track.duration || 0)}`.toLocaleLowerCase()

function isWithin(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

const transientReadErrors = new Set(['UNKNOWN', 'EIO', 'EBUSY', 'EPERM', 'ECONNRESET', 'ENETRESET', 'ENETUNREACH', 'ETIMEDOUT'])

async function retryTransient(operation, attempts = 5) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await operation() }
    catch (error) {
      if (!transientReadErrors.has(error?.code) || attempt >= attempts - 1) throw error
      await new Promise((resolve) => setTimeout(resolve, Math.min(3000, 500 * (2 ** attempt))))
    }
  }
}

async function* resilientFileChunks(filePath, start, end) {
  let position = start
  let retries = 0
  while (position <= end) {
    let handle
    try {
      handle = await fs.open(filePath, 'r')
      while (position <= end) {
        const buffer = Buffer.allocUnsafe(Math.min(256 * 1024, end - position + 1))
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
        if (!bytesRead) throw Object.assign(new Error('Unexpected end of media file'), { code: 'EIO' })
        position += bytesRead
        retries = 0
        yield bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead)
      }
    } catch (error) {
      if (!transientReadErrors.has(error?.code) || retries >= 5) throw error
      retries += 1
      await new Promise((resolve) => setTimeout(resolve, Math.min(3000, 500 * (2 ** (retries - 1)))))
    } finally {
      await handle?.close().catch(() => {})
    }
  }
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

async function extractTrack(filePath, index, sidecars, statsPromise, artworkFiles) {
  const [metadata, stats] = await Promise.all([parseFile(filePath, { duration: false }), statsPromise])
  const common = metadata.common
  const cover = selectCover(common.picture)
  let artwork = ''
  if (cover) {
    const extension = cover.format.includes('png') ? 'png' : 'jpg'
    const artworkName = `${createHash('sha1').update(cover.data).digest('hex')}.${extension}`
    const artworkFile = path.join(artworkPath(), artworkName)
    if (!artworkFiles.has(artworkName)) {
      artworkFiles.add(artworkName)
      try { await fs.writeFile(artworkFile, cover.data, { flag: 'wx' }) }
      catch (error) {
        if (error?.code !== 'EEXIST') { artworkFiles.delete(artworkName); throw error }
      }
    }
    artwork = mediaUrl(artworkFile)
  }
  let duration = metadata.format.duration || (metadata.format.bitrate ? stats.size * 8 / metadata.format.bitrate : 0)
  if (!duration) {
    const durationMetadata = await parseFile(filePath, { duration: true, skipCovers: true })
    duration = durationMetadata.format.duration || 0
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
    duration,
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

async function scanLibrary(sourceFolders, { foreground = false } = {}) {
  const folders = [...new Set(sourceFolders.map((folder) => path.resolve(folder)))]
  const previous = await readCache()
  const discoveries = await Promise.all(folders.map(async (folder) => {
    try {
      const stats = await fs.stat(folder)
      if (!stats.isDirectory()) throw new Error('Music library path is not a directory')
      return discoverFiles(folder)
    } catch {
      return { files: [], sidecars: new Map(), unavailableDirectories: [folder] }
    }
  }))
  const files = [...new Map(discoveries.flatMap((result) => result.files).map((filePath) => [pathKey(filePath), filePath])).values()].sort(comparePaths)
  const sidecars = new Map(discoveries.flatMap((result) => [...result.sidecars]))
  const unavailableDirectories = discoveries.flatMap((result) => result.unavailableDirectories)
  await fs.mkdir(artworkPath(), { recursive: true })
  const artworkFiles = new Set(await fs.readdir(artworkPath()))
  const byPath = new Map(previous.tracks.map((track) => [pathKey(track.path), track]))
  const bySignature = new Map()
  for (const track of previous.tracks) {
    const signature = trackSignature(track)
    bySignature.set(signature, bySignature.has(signature) ? null : track)
  }
  const tracks = new Array(files.length)
  let cursor = 0
  let completed = 0
  let lastProgressAt = 0
  const worker = async () => {
    while (cursor < files.length) {
      const index = cursor++
      const filePath = files[index]
      const cached = byPath.get(pathKey(filePath))
      try {
        const fileStatsPromise = fs.stat(filePath)
        const fileStats = cached ? await fileStatsPromise : null
        const unchanged = cached && (!cached.modifiedAt || (cached.modifiedAt === fileStats.mtimeMs && cached.fileSize === fileStats.size))
        tracks[index] = unchanged ? {
          ...cached,
          url: mediaUrl(filePath),
          lyricPath: await findLyrics(filePath, sidecars),
          fileSize: fileStats.size,
          modifiedAt: fileStats.mtimeMs,
        } : await extractTrack(filePath, index, sidecars, fileStatsPromise, artworkFiles)
        if (!cached) {
          const migrated = bySignature.get(trackSignature(tracks[index]))
          if (migrated) tracks[index] = { ...tracks[index], id: migrated.id, addedAt: migrated.addedAt }
        }
      } catch (error) {
        console.warn(`Could not read metadata for ${filePath}:`, error)
        if (cached) tracks[index] = { ...cached, url: mediaUrl(filePath) }
      }
      completed += 1
      const now = Date.now()
      if (foreground && (completed === files.length || now - lastProgressAt >= 100)) {
        lastProgressAt = now
        mainWindow?.webContents.send('library:progress', { current: completed, total: files.length })
      }
    }
  }
  const processors = os.availableParallelism?.() || 4
  const metadataWorkers = Math.min(files.length, Math.max(16, Math.min(48, processors * 2)))
  await Promise.all(Array.from({ length: metadataWorkers }, worker))
  const scannedPaths = new Set(files.map(pathKey))
  const preservedTracks = previous.tracks.filter((track) => !scannedPaths.has(pathKey(track.path)) && unavailableDirectories.some((directory) => isWithin(directory, track.path)))
  const remoteTracks = previous.tracks.filter((track) => track.sourceType === 'jellyfin')
  const liveTracks = [...tracks.filter(Boolean), ...preservedTracks, ...remoteTracks]
  const liveIds = new Set(liveTracks.map((track) => track.id))
  const library = await updateCache((latest) => ({
    folders, folder: folders[0] || '', tracks: liveTracks,
    history: latest.history.filter((id) => liveIds.has(id)), favorites: latest.favorites.filter((id) => liveIds.has(id)),
    liked: latest.liked.filter((id) => liveIds.has(id)), disliked: latest.disliked.filter((id) => liveIds.has(id)),
    playlists: latest.playlists.map((playlist) => ({ ...playlist, trackIds: playlist.trackIds.filter((id) => liveIds.has(id)) })),
    jellyfinServers: latest.jellyfinServers, settings: latest.settings,
  }))
  libraryRoots = folders
  return library
}

function requestScan(folders, options) {
  const operation = scanQueue.then(() => scanLibrary(folders, options))
  scanQueue = operation.then(() => undefined, () => undefined)
  return operation
}

function watchLibraries(folders) {
  for (const watcher of libraryWatchers) watcher.close()
  libraryWatchers = []
  clearTimeout(watchTimer)
  clearInterval(watchPoll)
  if (!folders.length) return
  const refresh = () => {
    clearTimeout(watchTimer)
    watchTimer = setTimeout(async () => {
      try {
        const library = await requestScan(folders, { foreground: false })
        mainWindow?.webContents.send('library:updated', library)
      } catch (error) { console.warn('Automatic library refresh failed:', error) }
    }, 8000)
  }
  for (const folder of folders) {
    try {
      const watcher = watch(folder, { recursive: true }, (_event, filename) => {
        if (filename && !audioExtensions.has(path.extname(filename).toLowerCase()) && path.extname(filename).toLowerCase() !== '.lrc') return
        refresh()
      })
      watcher.on('error', (error) => {
        console.warn(`Music library watcher stopped for ${folder}; periodic refresh remains active:`, error)
        watcher.close()
        libraryWatchers = libraryWatchers.filter((candidate) => candidate !== watcher)
      })
      libraryWatchers.push(watcher)
    } catch (error) { console.warn(`Could not watch music library ${folder}:`, error) }
  }
  watchPoll = setInterval(refresh, 30 * 60 * 1000)
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

async function jellyfinLyrics(lyricPath) {
  const [, encodedServerId, encodedItemId] = new URL(lyricPath).pathname.split('/')
  const serverId = decodeURIComponent(encodedServerId || '')
  const itemId = decodeURIComponent(encodedItemId || '')
  const access = await jellyfinAccess(serverId)
  if (!access || !itemId) return []
  const query = new URLSearchParams({ UserId: access.server.userId })
  const response = await jellyfinJson(access.server, access.credential, `/Audio/${encodeURIComponent(itemId)}/Lyrics?${query}`)
  if (!response.ok || !Array.isArray(response.data.Lyrics)) return []
  return response.data.Lyrics
    .filter((line) => typeof line?.Text === 'string' && line.Text.trim())
    .map((line) => ({ time: line.Start == null ? null : Number(line.Start) / 10000000, text: line.Text.trim() }))
}

async function jellyfinResponse(request) {
  try {
    const url = new URL(request.url)
    const [, kind, encodedServerId, encodedItemId, encodedFallbackId] = url.pathname.split('/')
    const serverId = decodeURIComponent(encodedServerId || '')
    const itemId = decodeURIComponent(encodedItemId || '')
    const fallbackId = decodeURIComponent(encodedFallbackId || '')
    const access = await jellyfinAccess(serverId)
    const server = access?.server
    const credential = access?.credential
    if (!server || !credential || !itemId) return new Response('Jellyfin source not found', { status: 404 })
    let endpoint
    if (kind === 'audio') {
      const query = new URLSearchParams({
        UserId: server.userId, DeviceId: credential.deviceId, Static: 'true',
      })
      if (fallbackId) query.set('MediaSourceId', fallbackId)
      endpoint = `/Audio/${encodeURIComponent(itemId)}/stream?${query}`
    } else if (kind === 'image') {
      const maxWidth = Math.min(1200, Math.max(64, Number(url.searchParams.get('maxWidth')) || 1200))
      endpoint = `/Items/${encodeURIComponent(itemId)}/Images/Primary?maxWidth=${maxWidth}&quality=90`
    } else return new Response('Unsupported Jellyfin resource', { status: 404 })
    const headers = {}
    const range = request.headers.get('range')
    if (range) headers.Range = range
    let upstream = await jellyfinFetch(server, credential, endpoint, { headers }, 0)
    if (kind === 'image' && !upstream.ok && fallbackId && fallbackId !== itemId) {
      const maxWidth = Math.min(1200, Math.max(64, Number(url.searchParams.get('maxWidth')) || 1200))
      endpoint = `/Items/${encodeURIComponent(fallbackId)}/Images/Primary?maxWidth=${maxWidth}&quality=90`
      upstream = await jellyfinFetch(server, credential, endpoint, { headers }, 0)
    }
    const responseHeaders = new Headers()
    for (const name of ['accept-ranges', 'cache-control', 'content-length', 'content-range', 'content-type', 'etag', 'last-modified']) {
      const value = upstream.headers.get(name)
      if (value) responseHeaders.set(name, value)
    }
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders })
  } catch (error) {
    console.warn('Jellyfin resource request failed:', error instanceof Error ? error.message : error)
    return new Response('Jellyfin resource unavailable', { status: 502 })
  }
}

const polarisResponse = (request) => new URL(request.url).hostname === 'jellyfin' ? jellyfinResponse(request) : mediaResponse(request)

async function mediaResponse(request) {
  let filePath
  let stats
  try {
    const token = new URL(request.url).pathname.slice(1)
    filePath = await retryTransient(() => fs.realpath(Buffer.from(token, 'base64url').toString()))
    const allowedRoots = [...libraryRoots, artworkPath()].filter(Boolean)
    const canonicalRoots = await Promise.all(allowedRoots.map((root) => retryTransient(() => fs.realpath(root)).catch(() => '')))
    if (!canonicalRoots.some((root) => root && isWithin(root, filePath))) throw new Error('Path is outside the media library')
    stats = await retryTransient(() => fs.stat(filePath))
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
  const stream = Readable.from(resilientFileChunks(filePath, start, end))
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
  const cachedLibrary = await readCache()
  watchLibraries(cachedLibrary.folders)
  protocol.handle('polaris', polarisResponse)
  ipcMain.handle('library:get', readCache)
  ipcMain.handle('library:add-source', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: 'Add a music source' })
    if (result.canceled) return null
    const current = await readCache()
    const folders = [...new Set([...current.folders, path.resolve(result.filePaths[0])])]
    const library = await requestScan(folders, { foreground: true })
    watchLibraries(library.folders)
    return library
  })
  ipcMain.handle('library:remove-source', async (_, folder) => {
    const library = await readCache()
    const folders = library.folders.filter((candidate) => pathKey(candidate) !== pathKey(folder))
    const next = await requestScan(folders, { foreground: true })
    watchLibraries(next.folders)
    return next
  })
  ipcMain.handle('library:rescan', async () => {
    const library = await readCache()
    return requestScan(library.folders, { foreground: true })
  })
  ipcMain.handle('jellyfin:connect', (_, credentials) => connectJellyfin(credentials))
  ipcMain.handle('jellyfin:refresh', (_, serverId) => syncJellyfinServer(serverId))
  ipcMain.handle('jellyfin:disconnect', (_, serverId) => disconnectJellyfin(serverId))
  ipcMain.handle('library:save-state', async (_, state) => {
    const allowed = {}
    for (const key of ['history', 'favorites', 'liked', 'disliked', 'playlists', 'settings']) if (state && key in state) allowed[key] = state[key]
    await updateCache((library) => ({ ...library, ...allowed }))
  })
  ipcMain.handle('lyrics:get', async (_, lyricPath, embedded, trackPath, track) => {
    try {
      if (lyricPath?.startsWith('jellyfin://lyrics/')) {
        const remoteLyrics = await jellyfinLyrics(lyricPath)
        if (remoteLyrics.length) return remoteLyrics
        return (await readCache()).settings.onlineLyrics ? onlineLyrics(track) : []
      }
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
  ipcMain.handle('updates:check', checkForUpdates)
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
      const cacheLifetime = cached?.resolvedArtist ? 30 * 24 * 60 * 60 * 1000 : 6 * 60 * 60 * 1000
      if (cached && typeof cached !== 'string' && cached.rankingVersion === artistRankingVersion && cached.requestedArtist === normalizedArtistName(artist) && Date.now() - cached.cachedAt < cacheLifetime) return cached

      const audioDbUrl = `${process.env.AUDIODB_API_URL || 'https://www.theaudiodb.com/api/v1/json/123/search.php'}?s=${encodeURIComponent(artist)}`
      const audioDbResponse = await net.fetch(audioDbUrl, { signal: AbortSignal.timeout(6000) })
      const audioDbData = audioDbResponse.ok ? await audioDbResponse.json() : {}
      const match = audioDbData.artists?.find((candidate) => exactArtistMatch(candidate.strArtist, artist))
      let profile = match?.strArtistThumb || ''
      let background = match?.strArtistFanart || match?.strArtistFanart2 || match?.strArtistWideThumb || profile
      let biography = match?.strBiographyEN || ''
      const genres = [...new Set([match?.strGenre, match?.strStyle, match?.strMood].filter(Boolean))]
      let mbid = match?.strMusicBrainzID || match?.idArtistMusicBrainz || ''
      let resolvedArtist = match?.strArtist || ''
      const audioDbUrls = [match?.strWebsite, match?.strFacebook, match?.strTwitter].map(externalUrl).filter(Boolean)
      let links = audioDbUrls.map((url) => ({ label: socialLabel(url), url }))

      if (!mbid) {
        const searchUrl = `${process.env.MUSICBRAINZ_API_URL || 'https://musicbrainz.org/ws/2'}/artist/?query=${encodeURIComponent(`artist:${artist}`)}&limit=3&fmt=json`
        const searchResponse = await musicBrainzFetch(searchUrl)
        const searchData = searchResponse.ok ? await searchResponse.json() : {}
        const musicBrainzMatch = searchData.artists?.find((candidate) => exactArtistMatch(candidate.name, artist) || candidate.aliases?.some((alias) => exactArtistMatch(alias.name, artist)))
        mbid = musicBrainzMatch?.id || ''
        resolvedArtist ||= musicBrainzMatch?.name || ''
      }
      if (mbid) {
        const relationResponse = await musicBrainzFetch(`${process.env.MUSICBRAINZ_API_URL || 'https://musicbrainz.org/ws/2'}/artist/${encodeURIComponent(mbid)}?inc=url-rels&fmt=json`)
        const relationData = relationResponse.ok ? await relationResponse.json() : {}
        const relationLinks = (relationData.relations || []).map((relation) => externalUrl(relation.url?.resource)).filter(Boolean).map((url) => ({ label: socialLabel(url), url }))
        links = [...new Map([...links, ...relationLinks].map((link) => [link.url, link])).values()].slice(0, 8)
      }

      let topRecordings = []
      if (mbid) {
        const listenBrainzToken = process.env.LISTENBRAINZ_TOKEN?.trim()
        const popularityResponse = await net.fetch(`${process.env.LISTENBRAINZ_API_URL || 'https://api.listenbrainz.org/1'}/popularity/top-recordings-for-artist/${encodeURIComponent(mbid)}`, {
          headers: listenBrainzToken ? { Authorization: `Token ${listenBrainzToken}` } : {},
          signal: AbortSignal.timeout(8000),
        })
        const popularityData = popularityResponse.ok ? await popularityResponse.json() : {}
        const candidateRecordings = popularityData.recordings || popularityData.payload?.recordings
        const recordings = Array.isArray(candidateRecordings) ? candidateRecordings : []
        topRecordings = recordings.map((recording, apiRank) => ({ title: recording.recording_name || recording.title || '', listens: Number(recording.listen_count || recording.total_listen_count || 0), listeners: Number(recording.listener_count || recording.total_user_count || 0), apiRank })).filter((recording) => recording.title).sort((left, right) => right.listeners - left.listeners || right.listens - left.listens || left.apiRank - right.apiRank).slice(0, 100).map((recording) => ({ title: recording.title, listens: recording.listens, listeners: recording.listeners }))
      }
      if (!topRecordings.length) {
        try {
          const deezerApi = process.env.DEEZER_API_URL || 'https://api.deezer.com'
          const artistResponse = await net.fetch(`${deezerApi}/search/artist?q=${encodeURIComponent(artist)}&limit=5`, { signal: AbortSignal.timeout(8000) })
          const artistData = artistResponse.ok ? await artistResponse.json() : {}
          const deezerArtist = (Array.isArray(artistData.data) ? artistData.data : []).find((candidate) => exactArtistMatch(candidate.name, artist))
          if (deezerArtist?.id) {
            const tracksResponse = await net.fetch(`${deezerApi}/artist/${encodeURIComponent(deezerArtist.id)}/top?limit=100`, { signal: AbortSignal.timeout(8000) })
            const tracksData = tracksResponse.ok ? await tracksResponse.json() : {}
            topRecordings = (Array.isArray(tracksData.data) ? tracksData.data : []).filter((recording) => recording.title).map((recording, apiRank) => ({ title: recording.title_short || recording.title, listens: Number(recording.rank || 0), listeners: 0, apiRank })).sort((left, right) => right.listens - left.listens || left.apiRank - right.apiRank).map((recording) => ({ title: recording.title, listens: recording.listens, listeners: recording.listeners }))
          }
        } catch {}
      }
      if (!topRecordings.length) {
        try {
          const catalogUrl = `${process.env.APPLE_SEARCH_API_URL || 'https://itunes.apple.com/search'}?term=${encodeURIComponent(artist)}&entity=song&attribute=artistTerm&limit=100`
          const catalogResponse = await net.fetch(catalogUrl, { signal: AbortSignal.timeout(8000) })
          const catalogData = catalogResponse.ok ? await catalogResponse.json() : {}
          topRecordings = (Array.isArray(catalogData.results) ? catalogData.results : []).filter((recording) => recording.kind === 'song' && catalogArtistMatch(recording.artistName, artist) && recording.trackName).map((recording) => ({ title: recording.trackName, listens: 0, listeners: 0 })).slice(0, 100)
        } catch {}
      }

      if (!biography || (!profile && !background)) {
        const wikipediaApi = process.env.WIKIPEDIA_API_URL || 'https://en.wikipedia.org/w/api.php'
        const wikiSearchUrl = `${wikipediaApi}?action=query&list=search&srsearch=${encodeURIComponent(`intitle:"${artist}" musician OR band`)}&srlimit=5&format=json&origin=*`
        const wikiSearchResponse = await net.fetch(wikiSearchUrl, { signal: AbortSignal.timeout(6000) })
        const wikiSearchData = wikiSearchResponse.ok ? await wikiSearchResponse.json() : {}
        const wikiMatches = (wikiSearchData.query?.search || []).filter((candidate) => wikipediaArtistMatch(candidate.title, artist)).sort((left, right) => Number(left.title === artist) - Number(right.title === artist))
        for (const wikiMatch of wikiMatches) {
          const summaryBase = process.env.WIKIPEDIA_SUMMARY_URL || 'https://en.wikipedia.org/api/rest_v1/page/summary'
          const summaryResponse = await net.fetch(`${summaryBase}/${encodeURIComponent(wikiMatch.title)}`, { signal: AbortSignal.timeout(6000) })
          const summary = summaryResponse.ok ? await summaryResponse.json() : {}
          if (summary.type === 'disambiguation' || !/\b(?:band|musician|singer|rapper|recording artist|musical group|music producer|dj|composer|songwriter|duo)\b/i.test(summary.description || '')) continue
          biography ||= summary.extract || ''
          profile ||= summary.thumbnail?.source || summary.originalimage?.source || ''
          background ||= summary.originalimage?.source || summary.thumbnail?.source || profile
          resolvedArtist ||= wikiMatch.title
          break
        }
      }

      const images = { profile, background, biography, genres, links, topRecordings, rankingVersion: artistRankingVersion, requestedArtist: normalizedArtistName(artist), resolvedArtist, cachedAt: Date.now() }
      artistImageCache[artist] = images
      await fs.writeFile(artistCachePath(), JSON.stringify(artistImageCache), 'utf8')
      return images
    } catch { return { profile: '', background: '', requestedArtist: normalizedArtistName(artist), resolvedArtist: '', cachedAt: Date.now() } }
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