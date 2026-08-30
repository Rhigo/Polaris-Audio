const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('polaris', {
  getLibrary: () => ipcRenderer.invoke('library:get'),
  chooseFolder: () => ipcRenderer.invoke('library:choose'),
  rescan: (folder) => ipcRenderer.invoke('library:rescan', folder),
  saveState: (state) => ipcRenderer.invoke('library:save-state', state),
  getLyrics: (lyricPath, embedded, trackPath, track) => ipcRenderer.invoke('lyrics:get', lyricPath, embedded, trackPath, track),
  getArtistImage: (artist) => ipcRenderer.invoke('artist:image', artist),
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
  onScanProgress: (callback) => {
    const handler = (_event, progress) => callback(progress)
    ipcRenderer.on('library:progress', handler)
    return () => ipcRenderer.removeListener('library:progress', handler)
  },
  onLibraryUpdated: (callback) => {
    const handler = (_event, library) => callback(library)
    ipcRenderer.on('library:updated', handler)
    return () => ipcRenderer.removeListener('library:updated', handler)
  },
})