import { contextBridge } from 'electron';
contextBridge.exposeInMainWorld('wildfireDashboard', { version: 1, dataMode: 'precomputed' });
