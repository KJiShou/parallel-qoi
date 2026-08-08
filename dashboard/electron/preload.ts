import { contextBridge, ipcRenderer } from 'electron'
import type { BackendAvailability, ConversionRequest, ConversionResponse, SelectedImage } from './services/types'

const api = {
  selectImage: (): Promise<SelectedImage | undefined> => ipcRenderer.invoke('file:select'),
  registerDroppedImage: (inputPath: string): Promise<SelectedImage> => ipcRenderer.invoke('file:register-dropped', inputPath),
  detectBackends: (): Promise<BackendAvailability[]> => ipcRenderer.invoke('backend:detect'),
  convertImage: (request: ConversionRequest): Promise<ConversionResponse> => ipcRenderer.invoke('conversion:convert', request),
  compareBackends: (requests: ConversionRequest[]): Promise<ConversionResponse[]> => ipcRenderer.invoke('conversion:compare', requests),
  saveQoi: (jobId: string): Promise<string | undefined> => ipcRenderer.invoke('conversion:save', jobId),
  cancelConversion: (jobId: string): Promise<boolean> => ipcRenderer.invoke('conversion:cancel', jobId),
  version: (): Promise<string> => ipcRenderer.invoke('app:version'),
}

contextBridge.exposeInMainWorld('pqoi', api)

