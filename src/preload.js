const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('catAPI', {
  getConfig:       ()      => ipcRenderer.invoke('get-config'),
  savePosition:    (pos)   => ipcRenderer.send('save-position', pos),
  saveState:       (state) => ipcRenderer.send('save-state', state),
  setIgnoreMouse:  (v)     => ipcRenderer.send('set-ignore-mouse', v),

  onFeed:    (cb) => ipcRenderer.on('tray-feed',      () => cb()),
  onWake:    (cb) => ipcRenderer.on('tray-wake',      () => cb()),
  onSetSize: (cb) => ipcRenderer.on('set-size',       (_, sz) => cb(sz)),
  onSuspend: (cb) => ipcRenderer.on('power-suspend',  () => cb()),
  onResume:  (cb) => ipcRenderer.on('power-resume',   () => cb()),
});
