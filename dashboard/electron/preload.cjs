const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('wildfireDesktop', {
  getCapabilities: () => ipcRenderer.invoke('wildfire:get-capabilities'),
  startRun: config => ipcRenderer.invoke('wildfire:start-run', config),
  cancelRun: runId => ipcRenderer.invoke('wildfire:cancel-run', runId),
  listRuns: () => ipcRenderer.invoke('wildfire:list-runs'),
  readRun: runId => ipcRenderer.invoke('wildfire:read-run', runId),
  onRunEvent: listener => { const wrapped=(_event,payload)=>listener(payload); ipcRenderer.on('wildfire:run-event',wrapped); return ()=>ipcRenderer.removeListener('wildfire:run-event',wrapped); }
});
