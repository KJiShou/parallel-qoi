const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('wildfireDashboard', { version: 1, dataMode: 'precomputed' });
