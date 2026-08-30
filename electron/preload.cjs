const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('polaris', {
  getLibrary: () => ipcRenderer.invoke('library:get'),
  chooseFolder: () => ipcRenderer.invoke('library:choose'),
  rescan: (folder) => ipcRenderer.invoke('library:rescan', folder),
  saveState: (state) => ipcRenderer.invoke('library:save-state', state),
  getLyrics: (lyricPath, embedded, trackPath, track) => ipcRenderer.invoke('lyrics:get', lyricPath, embedded, trackPath, track),
  getArtistImage: (artist) => ipcRenderer.invoke('artist:image', artist),
  onScanProgress: (callback) => {
    const handler = (_event, progress) => callback(progress)
    ipcRenderer.on('library:progress', handler)
    return () => ipcRenderer.removeListener('library:progress', handler)
  },
})