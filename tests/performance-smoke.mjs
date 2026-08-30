import { _electron as electron } from 'playwright-core'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'polaris-performance-'))
const profile = path.join(root, 'profile')
await fs.mkdir(profile, { recursive: true })

const tracks = Array.from({ length: 10000 }, (_, index) => ({
  id: `track-${index}`, path: `C:\\Music\\track-${index}.flac`, url: `polaris://media/dGVzdA`,
  title: index % 1000 === 0 ? `Needle Song ${index}` : `Library Song ${String(index).padStart(5, '0')}`,
  artist: `Artist ${index % 400}`, albumArtist: `Artist ${index % 400}`, album: `Album ${index % 800}`,
  year: 1980 + index % 46, track: index % 20 + 1, disc: 1, genre: 'Test', duration: 180 + index % 180,
  sampleRate: 44100, bitDepth: 16, lossless: true, artwork: '', lyricPath: '', addedAt: Date.now() - index,
}))
await fs.writeFile(path.join(profile, 'library.json'), JSON.stringify({ folder: 'C:\\Music', history: [], favorites: [], tracks }), 'utf8')

const app = await electron.launch({
  args: ['.'],
  env: { ...process.env, POLARIS_USER_DATA: profile, VITE_DEV_SERVER_URL: 'http://127.0.0.1:4174' },
})

try {
  const page = await app.firstWindow()
  await page.getByRole('heading', { name: 'Good evening.' }).waitFor({ timeout: 10000 })

  const songsStarted = performance.now()
  await page.getByRole('button', { name: 'Songs', exact: true }).click()
  await page.getByRole('heading', { name: 'Songs' }).waitFor()
  await page.locator('.track-row').nth(249).waitFor()
  const songsMs = Math.round(performance.now() - songsStarted)
  const renderedRows = await page.locator('.track-row').count()

  const searchStarted = performance.now()
  await page.getByPlaceholder('Search songs, artists, albums').fill('Needle')
  await page.locator('.search-tabs').getByRole('button', { name: 'Songs 10' }).waitFor()
  const searchMs = Math.round(performance.now() - searchStarted)

  console.log(JSON.stringify({ tracks: tracks.length, songsMs, searchMs, renderedRows }, null, 2))
  if (renderedRows !== 250) throw new Error(`Expected 250 rendered rows, found ${renderedRows}`)
  if (songsMs > 2000) throw new Error(`Songs view took ${songsMs}ms`)
  if (searchMs > 1500) throw new Error(`Search took ${searchMs}ms`)
} finally {
  await app.close()
  await fs.rm(root, { recursive: true, force: true })
}