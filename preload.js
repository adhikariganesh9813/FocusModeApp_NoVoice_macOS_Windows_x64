const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronStore', {
  loadStats: () => ipcRenderer.invoke('stats:load'),
  saveStats: (stats) => ipcRenderer.invoke('stats:save', stats),
  resetStats: () => ipcRenderer.invoke('stats:reset')
});
