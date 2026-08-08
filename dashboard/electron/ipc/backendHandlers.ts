import { ipcMain } from 'electron'
import type { BackendRegistry } from '../services/backendRegistry'

export function registerBackendHandlers(registry: BackendRegistry): void {
  ipcMain.handle('backend:detect', () => registry.detect())
}

