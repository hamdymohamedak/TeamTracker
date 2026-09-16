const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('teamtracker', {
  getStatus: () => ipcRenderer.invoke('tracker:getStatus'),
  enroll: (setupToken, serverUrl) => ipcRenderer.invoke('tracker:enroll', setupToken, serverUrl),
  updateConfig: (config) => ipcRenderer.invoke('tracker:updateConfig', config),
  setActiveProjectTask: (projectId, taskId) =>
    ipcRenderer.invoke('tracker:setActiveProjectTask', projectId, taskId),
});
