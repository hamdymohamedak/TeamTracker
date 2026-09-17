const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('liveViewCapture', {
  getSource: () => ipcRenderer.invoke('live-view:get-source'),
  signalOut: (signal) => ipcRenderer.send('live-view:signal-out', signal),
  pcState: (state, reason) => ipcRenderer.send('live-view:pc-state', { state, reason }),
  rendererReady: () => ipcRenderer.send('live-view:renderer-ready'),
  onStart: (cb) => {
    ipcRenderer.on('live-view:start', (_e, data) => cb(data));
  },
  onStop: (cb) => {
    ipcRenderer.on('live-view:stop', () => cb());
  },
  onSignalIn: (cb) => {
    ipcRenderer.on('live-view:signal-in', (_e, signal) => cb(signal));
  },
  onPrivacy: (cb) => {
    ipcRenderer.on('live-view:privacy', (_e, data) => cb(data));
  },
  onConstraints: (cb) => {
    ipcRenderer.on('live-view:constraints', (_e, data) => cb(data));
  },
});
