import { _electron as electron } from 'playwright-core'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'

function createWave(seconds = 3, sampleRate = 44100, metadata = {}) {
  const samples = seconds * sampleRate
  const dataSize = samples * 2
  const infoFields = [['INAM', metadata.title], ['IART', metadata.artist], ['IPRD', metadata.album], ['ICRD', metadata.year], ['IGNR', metadata.genre]].filter(([, value]) => value)
  const infoChunks = infoFields.map(([name, value]) => {
    const content = Buffer.from(`${value}\0`, 'utf8')
    const chunk = Buffer.alloc(8 + content.length + content.length % 2)
    chunk.write(name, 0)
    chunk.writeUInt32LE(content.length, 4)
    content.copy(chunk, 8)
    return chunk
  })
  const listSize = infoChunks.length ? 4 + infoChunks.reduce((total, chunk) => total + chunk.length, 0) : 0
  const buffer = Buffer.alloc(44 + dataSize + (listSize ? 8 + listSize : 0))
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(buffer.length - 8, 4)
  buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  for (let index = 0; index < samples; index += 1) {
    buffer.writeInt16LE(Math.sin(2 * Math.PI * 440 * index / sampleRate) * 5000, 44 + index * 2)
  }
  if (listSize) {
    let offset = 44 + dataSize
    buffer.write('LIST', offset)
    buffer.writeUInt32LE(listSize, offset + 4)
    buffer.write('INFO', offset + 8)
    offset += 12
    for (const chunk of infoChunks) { chunk.copy(buffer, offset); offset += chunk.length }
  }
  return buffer
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'polaris-smoke-'))
let lyricsRequests = 0
let updateRequests = 0
let jellyfinItemRequests = 0
let jellyfinAuthorizedRequests = 0
const jellyfinAudio = createWave(2)
const jellyfinArtwork = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
const lyricsServer = createServer((request, response) => {
  lyricsRequests += 1
  if (new URL(request.url, 'http://localhost').searchParams.get('track_name') === 'Rate Limited') {
    response.statusCode = 429
    response.setHeader('Retry-After', '1')
    response.end()
    return
  }
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify({ syncedLyrics: '[00:00.00]Online lyric fallback\n[00:01.00]LRCLIB response loaded' }))
})
await new Promise((resolve) => lyricsServer.listen(0, '127.0.0.1', resolve))
const lyricsAddress = lyricsServer.address()
const artistServer = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost')
  if (url.pathname === '/System/Info/Public') {
    response.setHeader('Content-Type', 'application/json')
    return response.end(JSON.stringify({ Id: 'test-jellyfin', ServerName: 'Work Jellyfin', Version: '10.10.7' }))
  }
  if (url.pathname === '/Users/AuthenticateByName') {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const credentials = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    response.setHeader('Content-Type', 'application/json')
    if (credentials.Username !== 'polaris' || credentials.Pw !== 'test-password') {
      response.statusCode = 401
      return response.end('{}')
    }
    return response.end(JSON.stringify({ AccessToken: 'raw-test-token', User: { Id: 'jellyfin-user', Name: 'polaris' } }))
  }
  if (url.pathname === '/Items') {
    jellyfinItemRequests += 1
    if (request.headers.authorization?.includes('Token="raw-test-token"')) jellyfinAuthorizedRequests += 1
    else { response.statusCode = 401; return response.end('{}') }
    await new Promise((resolve) => setTimeout(resolve, 150))
    response.setHeader('Content-Type', 'application/json')
    return response.end(JSON.stringify({ TotalRecordCount: 1, Items: [{
      Id: 'remote-track', Name: 'Remote Library Song', Album: 'Remote Album', AlbumId: 'remote-album',
      AlbumArtist: 'Remote Artist', Artists: ['Remote Artist'], Genres: ['Remote'], ProductionYear: 2026,
      IndexNumber: 3, ParentIndexNumber: 1, RunTimeTicks: 20000000, DateCreated: '2026-08-01T00:00:00Z',
      ImageTags: { Primary: 'image-tag' }, MediaSources: [{ Container: 'flac', Size: 123456, MediaStreams: [{ Type: 'Audio', SampleRate: 48000, BitDepth: 24 }] }],
    }] }))
  }
  if (url.pathname === '/Audio/remote-track/stream') {
    if (request.headers.authorization?.includes('Token="raw-test-token"')) jellyfinAuthorizedRequests += 1
    else { response.statusCode = 401; return response.end() }
    response.setHeader('Content-Type', 'audio/wav')
    response.setHeader('Content-Length', String(jellyfinAudio.length))
    return response.end(jellyfinAudio)
  }
  if (url.pathname === '/Items/remote-album/Images/Primary') {
    if (request.headers.authorization?.includes('Token="raw-test-token"')) jellyfinAuthorizedRequests += 1
    else { response.statusCode = 401; return response.end() }
    response.setHeader('Content-Type', 'image/png')
    return response.end(jellyfinArtwork)
  }
  response.setHeader('Content-Type', 'application/json')
  if (url.pathname === '/release') {
    updateRequests += 1
    return response.end(JSON.stringify({ tag_name: 'v1.0.11', html_url: 'https://github.com/Rhigo/Polaris-Audio/releases/tag/v1.0.11', assets: [{ name: 'Polaris-1.0.11-Portable.exe', browser_download_url: 'https://github.com/Rhigo/Polaris-Audio/releases/download/v1.0.11/Polaris-1.0.11-Portable.exe' }, { name: 'Polaris-1.0.11-Setup.exe', browser_download_url: 'https://github.com/Rhigo/Polaris-Audio/releases/download/v1.0.11/Polaris-1.0.11-Setup.exe' }] }))
  }
  if (url.pathname === '/audiodb') return response.end(JSON.stringify({ artists: [{ strArtist: 'Cold Play Tribute', strBiographyEN: 'Wrong artist.', strMusicBrainzID: 'wrong-mbid' }, { strArtist: 'Coldplay', strBiographyEN: 'A test biography.', strGenre: 'Alternative', strMusicBrainzID: 'test-mbid', strWebsite: 'coldplay.com', strTwitter: '0' }] }))
  if (url.pathname.includes('/artist/test-mbid')) return response.end(JSON.stringify({ relations: [{ url: { resource: 'https://instagram.com/coldplay' } }] }))
  if (url.pathname.includes('/top-recordings-for-artist/')) return response.end(JSON.stringify({ recordings: [{ recording_name: 'Polaris Test Tone (2026 Remaster)', listen_count: 500, listener_count: 300 }, { recording_name: 'Cloud Only Song', listen_count: 900, listener_count: 700 }] }))
  if (url.pathname === '/wiki') return response.end(JSON.stringify({ query: { search: [{ title: 'Wrong Hard Life' }, { title: 'Hard Life (band)' }] } }))
  if (url.pathname.startsWith('/summary/')) return response.end(JSON.stringify({ description: 'English alternative rock band', extract: 'Verified encyclopedia biography.', thumbnail: { source: 'https://example.com/hard-life.jpg' } }))
  response.statusCode = 404
  response.end('{}')
})
await new Promise((resolve) => artistServer.listen(0, '127.0.0.1', resolve))
const artistAddress = artistServer.address()
const profile = path.join(root, 'profile')
const music = path.join(root, 'music')
const secondMusic = path.join(root, 'music-secondary')
await fs.mkdir(profile, { recursive: true })
await fs.mkdir(music, { recursive: true })
await fs.mkdir(secondMusic, { recursive: true })
const trackPath = path.join(music, 'Polaris Test Tone.wav')
const secondTrackPath = path.join(music, 'Skip Target.wav')
const privatePath = path.join(root, 'not-in-library.txt')
const secondaryTrackPath = path.join(secondMusic, 'Secondary Source.wav')
await fs.writeFile(trackPath, createWave(3, 44100, { title: 'Polaris Test Tone', artist: 'Coldplay', album: 'Playback Tests', year: '2026', genre: 'Test' }))
await fs.writeFile(secondTrackPath, createWave(3, 44100, { title: 'Skip Target', artist: 'Coldplay', album: 'Skip Tests', year: '2025', genre: 'Skip' }))
await fs.writeFile(privatePath, 'private test data', 'utf8')
await fs.writeFile(secondaryTrackPath, createWave(1, 44100, { title: 'Secondary Source', artist: 'Secondary Artist', album: 'Remote Tests' }))
await fs.writeFile(path.join(music, 'Polaris Test Tone.lrc'), '[00:00.00]Polaris smoke lyric\n[00:01.00]Playback is working\n', 'utf8')
await fs.writeFile(path.join(music, 'Skip Target.lrc'), Array.from({ length: 30 }, (_, index) => `Static lyric ${index + 1}`).join('\n'), 'utf8')
const id = createHash('sha1').update(trackPath).digest('hex')
const url = `polaris://media/${Buffer.from(trackPath).toString('base64url')}`
const trackSize = (await fs.stat(trackPath)).size
const secondId = createHash('sha1').update(secondTrackPath).digest('hex')
const secondUrl = `polaris://media/${Buffer.from(secondTrackPath).toString('base64url')}`
await fs.writeFile(path.join(profile, 'library.json'), JSON.stringify({
  folder: music,
  history: [],
  favorites: [],
  tracks: [{
    id, path: trackPath, url, title: 'Polaris Test Tone', artist: 'Coldplay',
    albumArtist: 'Coldplay', album: 'Playback Tests', year: 2026, track: 1,
    disc: 1, genre: 'Test', duration: 3, sampleRate: 44100, bitDepth: 16,
    lossless: true, artwork: '', lyricPath: '', addedAt: Date.now(),
  }, {
    id: secondId, path: secondTrackPath, url: secondUrl, title: 'Skip Target', artist: 'Coldplay',
    albumArtist: 'Coldplay', album: 'Skip Tests', year: 2025, track: 1,
    disc: 1, genre: 'Skip', duration: 3, sampleRate: 44100, bitDepth: 16,
    lossless: true, artwork: '', lyricPath: '', addedAt: Date.now() - 1,
  }],
}), 'utf8')

const app = await electron.launch({
  args: ['.'],
  env: { ...process.env, POLARIS_USER_DATA: profile, VITE_DEV_SERVER_URL: 'http://127.0.0.1:4174', POLARIS_UPDATE_API_URL: `http://127.0.0.1:${artistAddress.port}/release`, LRCLIB_API_URL: `http://127.0.0.1:${lyricsAddress.port}/api/get`, AUDIODB_API_URL: `http://127.0.0.1:${artistAddress.port}/audiodb`, MUSICBRAINZ_API_URL: `http://127.0.0.1:${artistAddress.port}/musicbrainz`, LISTENBRAINZ_API_URL: `http://127.0.0.1:${artistAddress.port}/listenbrainz`, WIKIPEDIA_API_URL: `http://127.0.0.1:${artistAddress.port}/wiki`, WIKIPEDIA_SUMMARY_URL: `http://127.0.0.1:${artistAddress.port}/summary` },
})

try {
  const page = await app.firstWindow()
  page.on('console', (message) => console.log(`[renderer:${message.type()}] ${message.text()}`))
  await page.getByText('Polaris 1.0.11 is available').waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: 'Dismiss update' }).click()
  await page.getByRole('button', { name: 'Songs', exact: true }).click()
  await page.getByRole('button', { name: 'Play Polaris Test Tone' }).click()
  const range = await page.evaluate(async (mediaUrl) => {
    const response = await fetch(mediaUrl, { headers: { Range: 'bytes=0-43' } })
    const suffixResponse = await fetch(mediaUrl, { headers: { Range: 'bytes=-128' } })
    const fullResponse = await fetch(mediaUrl)
    return {
      status: response.status,
      range: response.headers.get('content-range'),
      length: (await response.arrayBuffer()).byteLength,
      suffixStatus: suffixResponse.status,
      suffixRange: suffixResponse.headers.get('content-range'),
      suffixLength: (await suffixResponse.arrayBuffer()).byteLength,
      fullStatus: fullResponse.status,
      fullLength: (await fullResponse.arrayBuffer()).byteLength,
    }
  }, url)
  await page.waitForFunction(() => {
    const audio = document.querySelector('audio')
    return audio && audio.currentTime > 0.25
  }, null, { timeout: 5000 })
  const audioState = await page.locator('audio').evaluate((audio) => ({
    currentSrc: audio.currentSrc,
    currentTime: audio.currentTime,
    duration: audio.duration,
    paused: audio.paused,
    readyState: audio.readyState,
    networkState: audio.networkState,
    error: audio.error ? { code: audio.error.code, message: audio.error.message } : null,
  }))
  console.log(JSON.stringify({ range, audioState }, null, 2))
  if (range.status !== 206 || range.length !== 44 || !range.range?.startsWith('bytes 0-43/')) {
    throw new Error(`Invalid media range response: ${JSON.stringify(range)}`)
  }
  if (range.suffixStatus !== 206 || range.suffixLength !== 128 || !range.suffixRange?.endsWith(`/${trackSize}`) || range.fullStatus !== 200 || range.fullLength !== trackSize) {
    throw new Error(`Invalid resilient media response: ${JSON.stringify(range)}`)
  }
  if (audioState.paused || audioState.currentTime <= 0.25) throw new Error(`Playback did not advance: ${JSON.stringify(audioState)}`)
  const skipStarted = performance.now()
  await page.getByRole('button', { name: 'Next' }).click()
  await page.waitForFunction((expectedUrl) => { const audio = document.querySelector('audio'); return audio?.currentSrc === expectedUrl && !audio.paused && audio.currentTime > 0.1 }, secondUrl, { timeout: 3000 })
  await page.getByRole('button', { name: 'Lyrics' }).click()
  await page.getByText('Static lyric 1', { exact: true }).waitFor()
  const staticLyricsStart = await page.locator('.right-panel .lyrics').evaluate((element) => element.scrollTop)
  await page.waitForFunction(() => { const audio = document.querySelector('audio'); return audio && audio.currentTime > 0.8 }, null, { timeout: 3000 })
  const staticLyricsEnd = await page.locator('.right-panel .lyrics').evaluate((element) => element.scrollTop)
  if (staticLyricsEnd <= staticLyricsStart) throw new Error(`Unsynchronized lyrics did not auto-scroll: ${staticLyricsStart} -> ${staticLyricsEnd}`)
  const staticAutoScroll = page.getByRole('checkbox', { name: 'Auto-scroll' })
  await staticAutoScroll.uncheck()
  await page.waitForFunction(() => window.polaris.getLibrary().then((value) => value.settings.staticLyricsAutoScroll === false))
  await page.locator('.right-panel .lyrics').evaluate((element) => { element.scrollTop = 0 })
  const staticAutoScrollDisabledAt = await page.locator('audio').evaluate((audio) => audio.currentTime)
  await page.waitForFunction((startedAt) => { const audio = document.querySelector('audio'); return audio && audio.currentTime > startedAt + 0.25 }, staticAutoScrollDisabledAt, { timeout: 3000 })
  const staticLyricsDisabledEnd = await page.locator('.right-panel .lyrics').evaluate((element) => element.scrollTop)
  if (staticLyricsDisabledEnd !== 0) throw new Error(`Disabled static lyric auto-scroll moved the sheet to ${staticLyricsDisabledEnd}`)
  await staticAutoScroll.check()
  await page.getByRole('button', { name: 'Close panel' }).click()
  await page.getByRole('button', { name: 'Previous' }).click()
  await page.waitForFunction((expectedUrl) => { const audio = document.querySelector('audio'); return audio?.currentSrc === expectedUrl && !audio.paused && audio.currentTime > 0.1 }, url, { timeout: 3000 })
  const skipMs = Math.round(performance.now() - skipStarted)
  if (skipMs > 2500) throw new Error(`Track skipping was unexpectedly slow: ${skipMs}ms`)
  await page.getByRole('button', { name: 'Visualizer' }).click()
  await page.locator('.visualizer').waitFor()
  const volumeStartedAt = await page.locator('audio').evaluate((audio) => audio.currentTime)
  await page.locator('.volume input').evaluate((input) => {
    for (let step = 0; step <= 80; step += 1) {
      input.value = String(0.2 + step / 200)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
  })
  await page.waitForFunction(() => window.polaris.getLibrary().then((value) => Math.abs(value.settings.volume - 0.6) < 0.001), null, { timeout: 3000 })
  await page.waitForFunction((startedAt) => { const audio = document.querySelector('audio'); return audio && !audio.paused && audio.currentTime > startedAt + 0.2 }, volumeStartedAt, { timeout: 3000 })
  const blockedUrl = `polaris://media/${Buffer.from(privatePath).toString('base64url')}`
  const blockedStatus = await page.evaluate(async (mediaUrl) => (await fetch(mediaUrl)).status, blockedUrl)
  if (blockedStatus !== 404) throw new Error(`Media path guard failed with status ${blockedStatus}`)
  console.log('media guard passed; starting rescan')
  const scanMs = await page.evaluate(async (historyId) => {
    const started = performance.now()
    await Promise.all([window.polaris.rescan(), window.polaris.saveState({ history: [historyId] })])
    return performance.now() - started
  }, secondId)
  console.log(`rescan completed in ${Math.round(scanMs)}ms`)
  if (scanMs > 5000) throw new Error(`Fixture rescan was unexpectedly slow: ${scanMs}ms`)
  const stateAfterScan = await page.evaluate(() => window.polaris.getLibrary())
  if (stateAfterScan.history[0] !== secondId) throw new Error(`Concurrent rescan lost user state: ${JSON.stringify(stateAfterScan.history)}`)
  await page.evaluate((historyId) => window.polaris.saveState({ history: [historyId] }), id)

  await page.getByRole('button', { name: 'Lyrics' }).click()
  await page.getByRole('button', { name: 'Polaris smoke lyric' }).waitFor({ timeout: 5000 })
  if (lyricsRequests !== 0) throw new Error('Local lyrics unexpectedly triggered an online lookup')
  const onlineLyrics = await page.evaluate(() => window.polaris.getLyrics('', '', '', { title: 'Online Test', artist: 'Polaris', album: 'Tests', duration: 3 }))
  if (onlineLyrics[0]?.text !== 'Online lyric fallback' || onlineLyrics[1]?.time !== 1) throw new Error(`Online lyric fallback failed: ${JSON.stringify(onlineLyrics)}`)
  await page.evaluate(() => window.polaris.getLyrics('', '', '', { title: 'Online Test', artist: 'Polaris', album: 'Tests', duration: 3 }))
  if (lyricsRequests !== 1) throw new Error(`Online lyrics cache missed: ${lyricsRequests} requests`)
  const limitedLyrics = await page.evaluate(() => window.polaris.getLyrics('', '', '', { title: 'Rate Limited', artist: 'Polaris', album: 'Tests', duration: 3 }))
  if (limitedLyrics.length || lyricsRequests !== 2) throw new Error(`Online lyrics rate limit handling failed: ${lyricsRequests} requests`)
  const playback = await page.locator('audio').evaluate((audio) => ({ currentTime: audio.currentTime, duration: audio.duration, paused: audio.paused }))
  await page.getByRole('button', { name: 'Close panel' }).click()

  await page.getByRole('button', { name: 'Artists', exact: true }).click()
  await page.locator('.artist-card').filter({ hasText: 'Coldplay' }).click()
  await page.getByRole('button', { name: 'Go back' }).waitFor()
  if (process.env.POLARIS_SMOKE_SCREENSHOT) {
    await page.getByText('A test biography.').waitFor({ timeout: 10000 })
    await page.screenshot({ path: process.env.POLARIS_SMOKE_SCREENSHOT })
  }
  await page.locator('.album-card').filter({ hasText: 'Playback Tests' }).click()
  await page.getByRole('button', { name: 'Go back' }).click()
  await page.getByRole('heading', { name: 'Coldplay' }).waitFor()
  await page.getByRole('button', { name: 'Songs', exact: true }).click()
  await page.getByRole('heading', { name: 'Songs' }).waitFor()
  if (await page.getByRole('button', { name: 'Go back' }).count()) throw new Error('Detail history was not cleared by sidebar navigation')

  await page.getByRole('button', { name: 'Genres', exact: true }).click()
  await page.getByRole('heading', { name: 'Genres' }).waitFor()
  if (process.env.POLARIS_DOCS_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.POLARIS_DOCS_SCREENSHOTS, 'genres.png') })
  await page.getByRole('button', { name: /Test 1 songs/ }).click()
  await page.getByRole('heading', { name: 'Test', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Decades', exact: true }).click()
  await page.getByRole('button', { name: /2020s 2 songs/ }).click()
  await page.getByRole('heading', { name: '2020s', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Songs', exact: true }).click()

  const sort = page.locator('.sort-control select')
  await sort.selectOption('title-desc')
  if (await sort.inputValue() !== 'title-desc') throw new Error('Song sorting did not update')

  await page.locator('.track-artist').first().click()
  await page.getByRole('heading', { name: 'Coldplay' }).waitFor()
  await page.getByRole('button', { name: 'Instagram' }).waitFor({ timeout: 10000 })
  if (await page.getByRole('button', { name: '0', exact: true }).count()) throw new Error('Placeholder artist URL was rendered')
  await page.getByText('A test biography.').waitFor()
  if (await page.getByText('Cloud Only Song').count()) throw new Error('Artist popularity rendered a song that is not in the local library')
  const popularTracks = await page.locator('.artist-detail > .track-list').first().locator('.track-name').allTextContents()
  if (JSON.stringify(popularTracks) !== JSON.stringify(['Polaris Test Tone', 'Skip Target'])) throw new Error(`Artist popularity order was incorrect: ${JSON.stringify(popularTracks)}`)
  const popularityPayload = await page.evaluate(() => window.polaris.getArtistImage('Coldplay'))
  if (popularityPayload.topRecordings?.[0]?.title !== 'Cloud Only Song') throw new Error(`Artist popularity scores were not sorted: ${JSON.stringify(popularityPayload.topRecordings)}`)
  const fallbackArtist = await page.evaluate(() => window.polaris.getArtistImage('Hard Life'))
  if (fallbackArtist.biography !== 'Verified encyclopedia biography.' || fallbackArtist.resolvedArtist !== 'Hard Life (band)') throw new Error(`Artist identity fallback failed: ${JSON.stringify(fallbackArtist)}`)
  await page.getByRole('button', { name: 'Go back' }).click()
  await page.getByRole('heading', { name: 'Songs' }).waitFor()

  await page.getByRole('button', { name: 'More options for Polaris Test Tone' }).click()
  await page.getByRole('button', { name: 'Add to loved songs' }).click()
  await page.getByRole('button', { name: 'More options for Polaris Test Tone' }).click()
  await page.locator('.row-menu').getByRole('button', { name: 'Remove from loved songs' }).waitFor()
  await page.getByRole('button', { name: 'Add to queue' }).click()
  await page.getByRole('button', { name: 'Queue' }).click()
  await page.locator('.queue').getByText('Polaris Test Tone').waitFor()
  await page.getByRole('button', { name: 'Close panel' }).click()

  await page.getByLabel('New playlist name').fill('Night Drive')
  await page.getByRole('button', { name: 'Create playlist' }).click()
  await page.getByRole('heading', { name: 'Night Drive' }).waitFor()
  await page.getByRole('button', { name: 'Rename playlist' }).click()
  await page.getByLabel('Playlist name', { exact: true }).fill('Moonlight')
  await page.getByRole('button', { name: 'Save playlist name' }).click()
  await page.getByRole('heading', { name: 'Moonlight' }).waitFor()
  await page.getByRole('button', { name: 'Songs', exact: true }).click()
  await page.locator('.track-row').filter({ hasText: 'Polaris Test Tone' }).dragTo(page.locator('.playlist-nav button').filter({ hasText: 'Moonlight' }))
  await page.locator('.playlist-nav button').filter({ hasText: 'Moonlight' }).click()
  await page.getByRole('button', { name: 'Play Polaris Test Tone' }).waitFor()
  const savedPlaylist = await page.evaluate(() => window.polaris.getLibrary().then((value) => value.playlists[0]))
  if (savedPlaylist?.name !== 'Moonlight' || savedPlaylist.trackIds.length !== 1) throw new Error(`Playlist persistence failed: ${JSON.stringify(savedPlaylist)}`)

  await page.getByRole('button', { name: 'Songs', exact: true }).click()
  await page.getByRole('button', { name: 'More options for Skip Target' }).click()
  await page.locator('.row-menu').getByRole('button', { name: 'Add to Moonlight' }).click()
  await page.locator('.playlist-nav button').filter({ hasText: 'Moonlight' }).click()
  const playlistRows = page.locator('.track-row')
  await playlistRows.filter({ hasText: 'Skip Target' }).dragTo(playlistRows.filter({ hasText: 'Polaris Test Tone' }), { targetPosition: { x: 10, y: 2 } })
  await page.waitForFunction(([firstId, secondId]) => window.polaris.getLibrary().then((value) => value.playlists[0]?.trackIds.join(',') === `${secondId},${firstId}`), [id, secondId])

  await page.getByRole('button', { name: 'Play Polaris Test Tone' }).click()
  await page.getByRole('button', { name: 'Thumbs up' }).click()
  await page.waitForFunction(() => window.polaris.getLibrary().then((value) => value.liked.length === 1 && value.disliked.length === 0))
  await page.getByRole('button', { name: 'Thumbs down' }).click()
  await page.waitForFunction(() => window.polaris.getLibrary().then((value) => value.liked.length === 0 && value.disliked.length === 1))
  await page.getByRole('button', { name: 'Add to playlist' }).click()
  await page.locator('.player-playlist-menu').getByRole('button', { name: 'Moonlight' }).click()

  await page.getByRole('button', { name: 'Supermix', exact: true }).click()
  await page.getByRole('heading', { name: 'Supermix' }).waitFor()
  if (await page.getByRole('button', { name: 'Play Polaris Test Tone' }).count()) throw new Error('Disliked track was included in Supermix')
  const mixBeforePlayback = await page.locator('.track-row .track-name').allTextContents()
  await page.locator('.track-row .track-name').first().click()
  const mixAfterPlayback = await page.locator('.track-row .track-name').allTextContents()
  if (JSON.stringify(mixAfterPlayback) !== JSON.stringify(mixBeforePlayback)) throw new Error(`Supermix changed during playback: ${JSON.stringify({ mixBeforePlayback, mixAfterPlayback })}`)
  await page.getByRole('button', { name: 'Regenerate' }).click()
  await page.getByRole('button', { name: 'Songs', exact: true }).click()
  await page.getByRole('button', { name: 'Play Polaris Test Tone' }).click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('heading', { name: 'Settings' }).waitFor()
  const migratedLibrary = await page.evaluate(() => window.polaris.getLibrary())
  if (migratedLibrary.folders.length !== 1 || migratedLibrary.folders[0] !== migratedLibrary.folder) throw new Error(`Legacy folder migration failed: ${JSON.stringify(migratedLibrary.folders)}`)
  await page.getByLabel('Server URL').fill(`http://127.0.0.1:${artistAddress.port}`)
  await page.getByLabel('Username').fill('polaris')
  await page.getByLabel('Password').fill('test-password')
  await page.getByRole('button', { name: 'Connect' }).click()
  await page.getByRole('status').waitFor()
  await page.getByText('Work Jellyfin', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Songs', exact: true }).click()
  await page.getByRole('button', { name: 'Play Remote Library Song' }).waitFor()
  const jellyfinLibrary = await page.evaluate(() => window.polaris.getLibrary())
  const jellyfinTrack = jellyfinLibrary.tracks.find((track) => track.sourceType === 'jellyfin')
  if (!jellyfinTrack || jellyfinTrack.title !== 'Remote Library Song' || jellyfinTrack.sampleRate !== 48000 || jellyfinTrack.bitDepth !== 24 || !jellyfinTrack.lossless) throw new Error(`Jellyfin metadata mapping failed: ${JSON.stringify(jellyfinTrack)}`)
  if (jellyfinTrack.url.includes('raw-test-token') || jellyfinTrack.artwork.includes('raw-test-token')) throw new Error('Jellyfin token leaked into a renderer media URL')
  const jellyfinResources = await page.evaluate(async (track) => {
    const [audio, artwork] = await Promise.all([fetch(track.url), fetch(track.artwork)])
    return { audioStatus: audio.status, audioBytes: (await audio.arrayBuffer()).byteLength, artworkStatus: artwork.status, artworkType: artwork.headers.get('content-type') }
  }, jellyfinTrack)
  if (jellyfinResources.audioStatus !== 200 || jellyfinResources.audioBytes !== jellyfinAudio.length || jellyfinResources.artworkStatus !== 200 || jellyfinResources.artworkType !== 'image/png') throw new Error(`Jellyfin proxy failed: ${JSON.stringify(jellyfinResources)}`)
  await page.getByRole('button', { name: 'Songs', exact: true }).click()
  await page.getByRole('heading', { name: 'Songs' }).waitFor()
  await page.getByRole('button', { name: 'Play Remote Library Song' }).click()
  await page.waitForFunction((remoteUrl) => { const audio = document.querySelector('audio'); return audio?.currentSrc === remoteUrl && !audio.paused && audio.currentTime > 0.1 }, jellyfinTrack.url)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('heading', { name: 'Settings' }).waitFor()
  const credentialFile = await fs.readFile(path.join(profile, 'jellyfin-credentials.json'), 'utf8')
  if (credentialFile.includes('test-password') || credentialFile.includes('raw-test-token')) throw new Error('Jellyfin credentials were stored without encryption')
  await page.getByRole('button', { name: 'Refresh Work Jellyfin' }).click()
  await page.waitForFunction(() => window.polaris.getLibrary().then((value) => value.jellyfinServers[0]?.lastSyncedAt > 0))
  if (jellyfinItemRequests < 2 || jellyfinAuthorizedRequests < 4) throw new Error(`Jellyfin authenticated requests were incomplete: ${JSON.stringify({ jellyfinItemRequests, jellyfinAuthorizedRequests })}`)
  await page.getByRole('button', { name: 'Disconnect Work Jellyfin' }).click()
  await page.waitForFunction(() => window.polaris.getLibrary().then((value) => value.jellyfinServers.length === 0 && !value.tracks.some((track) => track.sourceType === 'jellyfin')))
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, secondMusic)
  await page.getByRole('button', { name: 'Add source' }).click()
  await page.waitForFunction(() => window.polaris.getLibrary().then((value) => value.folders.length === 2 && value.tracks.some((track) => track.title === 'Secondary Source')))
  await page.locator('.source-item').nth(1).waitFor()
  if (await page.locator('.source-item').count() !== 2) throw new Error('Settings did not render both music sources')
  const secondaryMediaStatus = await page.evaluate(async (trackPath) => {
    const library = await window.polaris.getLibrary()
    const track = library.tracks.find((candidate) => candidate.path === trackPath)
    return track ? (await fetch(track.url, { headers: { Range: 'bytes=0-43' } })).status : 0
  }, secondaryTrackPath)
  if (secondaryMediaStatus !== 206) throw new Error(`Secondary source media was not authorized: ${secondaryMediaStatus}`)
  await page.getByText('Polaris 1.0.11 is ready to download.').waitFor()
  await page.getByRole('button', { name: 'Check for updates' }).click()
  await page.waitForFunction(() => document.body.textContent?.includes('Polaris 1.0.11 is ready to download.'))
  if (updateRequests < 2) throw new Error(`Manual update check did not reach the release endpoint: ${updateRequests}`)
  const updateInfo = await page.evaluate(() => window.polaris.checkForUpdates())
  if (!updateInfo.downloadUrl.endsWith('Polaris-1.0.11-Setup.exe')) throw new Error(`Updater did not prefer the installed build: ${updateInfo.downloadUrl}`)
  await page.getByRole('button', { name: 'Get version 1.0.11' }).waitFor()
  const titleLogo = page.locator('.wordmark img')
  await titleLogo.waitFor()
  if (!await titleLogo.evaluate((image) => image.complete && image.naturalWidth > 0)) throw new Error('Application logo did not load')
  await page.getByRole('button', { name: 'Coral' }).click()
  await page.waitForFunction(() => window.polaris.getLibrary().then((value) => value.settings.accentColor === '#f0504d'))
  const coralAccent = await page.locator('.app').evaluate((element) => getComputedStyle(element).getPropertyValue('--accent').trim())
  if (coralAccent !== '#f0504d') throw new Error(`Theme accent was not applied: ${coralAccent}`)
  await page.getByRole('button', { name: 'Polaris purple' }).click()
  await page.waitForFunction(() => window.polaris.getLibrary().then((value) => value.settings.accentColor === '#6832c2'))
  const onlineToggle = page.getByRole('checkbox', { name: /Online fallback/ })
  await onlineToggle.uncheck()
  await page.waitForFunction(() => window.polaris.getLibrary().then((value) => value.settings.onlineLyrics === false))
  await onlineToggle.check()
  await page.getByLabel('Style').selectOption('waveform')
  await page.getByLabel('Intensity').fill('0.7')
  await page.waitForFunction(() => window.polaris.getLibrary().then((value) => value.settings.visualizerStyle === 'waveform' && value.settings.visualizerIntensity === 0.7))
  if (process.env.POLARIS_DOCS_SCREENSHOTS) {
    const dismissUpdate = page.getByRole('button', { name: 'Dismiss update' })
    if (await dismissUpdate.count()) await dismissUpdate.click()
    await page.locator('.scan-toast').waitFor({ state: 'hidden', timeout: 5000 })
    await page.locator('.content').evaluate((element) => { element.scrollTop = 0 })
    await page.screenshot({ path: path.join(process.env.POLARIS_DOCS_SCREENSHOTS, 'settings-desktop.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: path.join(process.env.POLARIS_DOCS_SCREENSHOTS, 'settings-mobile.png') })
    await page.setViewportSize({ width: 1440, height: 900 })
  }
  await page.getByRole('button', { name: 'Songs', exact: true }).click()
  await page.getByRole('heading', { name: 'Songs' }).waitFor()

  const search = page.getByPlaceholder('Search songs, artists, albums')
  await search.fill('Coldplay')
  await page.getByRole('heading', { name: 'Results for “Coldplay”' }).waitFor()
  const searchTabs = page.locator('.search-tabs')
  await searchTabs.getByRole('button', { name: 'Songs 0' }).waitFor()
  await searchTabs.getByRole('button', { name: /^Artists [1-9]\d*$/ }).click()
  if (process.env.POLARIS_SEARCH_SCREENSHOT) {
    await page.screenshot({ path: `${process.env.POLARIS_SEARCH_SCREENSHOT}-desktop-final.png` })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: `${process.env.POLARIS_SEARCH_SCREENSHOT}-mobile-final.png` })
    await page.setViewportSize({ width: 1440, height: 900 })
  }
  await page.locator('.artist-card').filter({ hasText: 'Coldplay' }).click()
  await page.getByRole('heading', { name: 'Coldplay' }).waitFor()
  await page.getByRole('button', { name: 'Go back' }).click()
  await page.getByRole('heading', { name: 'Results for “Coldplay”' }).waitFor()
  await page.getByRole('button', { name: 'Go back' }).click()
  await page.getByRole('heading', { name: 'Songs' }).waitFor()
  if (await search.inputValue()) throw new Error('Back from search did not clear the query')

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.locator('.now-art-button').click()
  await page.locator('.now-playing.expanded').waitFor()
  await page.getByRole('button', { name: 'Lyrics', exact: true }).click()
  await page.locator('.immersive-lyrics').getByRole('button', { name: 'Polaris smoke lyric' }).waitFor()
  const playerBeforeScroll = await page.locator('.now-playing.expanded').boundingBox()
  await page.locator('.immersive-lyrics').evaluate((element) => { element.scrollTop = element.scrollHeight })
  const playerAfterScroll = await page.locator('.now-playing.expanded').boundingBox()
  if (!playerBeforeScroll || !playerAfterScroll || playerBeforeScroll.y !== playerAfterScroll.y || playerBeforeScroll.height !== playerAfterScroll.height) throw new Error('Lyrics scrolling shifted the expanded player')
  if (process.env.POLARIS_PLAYER_SCREENSHOT) await page.screenshot({ path: `${process.env.POLARIS_PLAYER_SCREENSHOT}-desktop.png` })
  await page.getByRole('button', { name: 'Back to artwork' }).click()
  await page.getByRole('button', { name: 'Close full player' }).click()

  await page.locator('.now-links').getByRole('button', { name: 'Coldplay' }).click()
  await page.getByRole('heading', { name: 'Coldplay' }).waitFor()
  await page.getByRole('button', { name: 'Go back' }).click()
  await page.locator('.now-links').getByRole('button', { name: 'Playback Tests' }).click()
  await page.getByRole('heading', { name: 'Playback Tests' }).waitFor()

  await page.setViewportSize({ width: 390, height: 844 })
  const mobileSearchBounds = await page.locator('.global-search').boundingBox()
  if (!mobileSearchBounds || mobileSearchBounds.x + mobileSearchBounds.width > 244) throw new Error(`Mobile search overlaps Windows caption controls: ${JSON.stringify(mobileSearchBounds)}`)
  await page.locator('.now-art-button').click()
  const mobileControls = await page.evaluate(() => ({
    previous: getComputedStyle(document.querySelector('[aria-label="Previous"]')).display,
    next: getComputedStyle(document.querySelector('[aria-label="Next"]')).display,
    volume: getComputedStyle(document.querySelector('.now-playing.expanded .volume')).display,
  }))
  if (mobileControls.previous === 'none' || mobileControls.next === 'none' || mobileControls.volume === 'none') throw new Error(`Mobile playback controls are hidden: ${JSON.stringify(mobileControls)}`)
  await page.getByRole('button', { name: 'Lyrics', exact: true }).click()
  await page.locator('.immersive-lyrics').waitFor()
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.mobile-art')).opacity) < 0.1)
  const mobilePlayerState = await page.evaluate(() => ({
    titlebarVisible: getComputedStyle(document.querySelector('.titlebar')).visibility !== 'hidden',
    artworkOpacity: Number(getComputedStyle(document.querySelector('.mobile-art')).opacity),
  }))
  if (!mobilePlayerState.titlebarVisible || mobilePlayerState.artworkOpacity > 0.1) throw new Error(`Invalid mobile lyric state: ${JSON.stringify(mobilePlayerState)}`)
  if (process.env.POLARIS_PLAYER_SCREENSHOT) await page.screenshot({ path: `${process.env.POLARIS_PLAYER_SCREENSHOT}-mobile.png` })
  await page.getByRole('button', { name: 'Back to artwork' }).click()
  await page.getByRole('button', { name: 'Close full player' }).click()

  await fs.writeFile(path.join(music, 'Automatically Added.wav'), createWave(1))
  if (await page.locator('.scan-toast').count()) throw new Error('Automatic refresh displayed foreground scan progress')
  await page.waitForFunction(() => window.polaris.getLibrary().then((value) => value.tracks.some((track) => track.title === 'Automatically Added')), null, { timeout: 15000 })
  if (await page.locator('.scan-toast').count()) throw new Error('Automatic refresh left foreground scan progress visible')

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  for (const folder of [music, secondMusic]) await page.getByRole('button', { name: `Remove ${folder}`, exact: true }).click()
  await page.getByRole('heading', { name: 'Jellyfin servers' }).waitFor()
  await page.getByRole('button', { name: 'Add music source' }).click()
  await page.getByRole('button', { name: /^Folder/ }).waitFor()
  await page.getByRole('button', { name: /^Add Jellyfin server/ }).click()
  await page.getByRole('heading', { name: 'Jellyfin servers' }).waitFor()

  console.log(JSON.stringify({ playback, range, scanMs: Math.round(scanMs), mediaGuard: 'passed', automaticLibraryUpdate: 'passed', discovery: 'passed', emptyLibrarySources: 'passed', feedback: 'passed', jellyfin: 'passed', lyrics: 'loaded', navigation: 'passed', playlists: 'passed', supermix: 'passed', settings: 'passed', search: 'passed', sorting: 'passed', rowMenu: 'passed', immersivePlayer: 'passed' }, null, 2))
} finally {
  await app.close()
  lyricsServer.close()
  artistServer.close()
  await fs.rm(root, { recursive: true, force: true })
}
