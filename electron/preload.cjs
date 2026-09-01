const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('polaris', {
  getLibrary: () => ipcRenderer.invoke('library:get'),
  addSource: () => ipcRenderer.invoke('library:add-source'),
  removeSource: (folder) => ipcRenderer.invoke('library:remove-source', folder),
  rescan: () => ipcRenderer.invoke('library:rescan'),
  connectJellyfin: (credentials) => ipcRenderer.invoke('jellyfin:connect', credentials),
  refreshJellyfin: (serverId) => ipcRenderer.invoke('jellyfin:refresh', serverId),
  disconnectJellyfin: (serverId) => ipcRenderer.invoke('jellyfin:disconnect', serverId),
  saveState: (state) => ipcRenderer.invoke('library:save-state', state),
  getLyrics: (lyricPath, embedded, trackPath, track) => ipcRenderer.invoke('lyrics:get', lyricPath, embedded, trackPath, track),
  getArtistImage: (artist) => ipcRenderer.invoke('artist:image', artist),
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  onScanProgress: (callback) => {
    const handler = (_event, progress) => callback(progress)
    ipcRenderer.on('library:progress', handler)
    return () => ipcRenderer.removeListener('library:progress', handler)
  },
  onJellyfinProgress: (callback) => {
    const handler = (_event, progress) => callback(progress)
    ipcRenderer.on('jellyfin:progress', handler)
    return () => ipcRenderer.removeListener('jellyfin:progress', handler)
  },
  onLibraryUpdated: (callback) => {
    const handler = (_event, library) => callback(library)
    ipcRenderer.on('library:updated', handler)
    return () => ipcRenderer.removeListener('library:updated', handler)
  },
})