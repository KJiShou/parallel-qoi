import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { BackendRegistry } from './services/backendRegistry'
import { ProcessRunner } from './services/processRunner'
import { TempFileService } from './services/tempFileService'
import { ConversionService } from './services/conversionService'
import { registerBackendHandlers } from './ipc/backendHandlers'
import { registerConversionHandlers } from './ipc/conversionHandlers'
import { registerFileHandlers } from './ipc/fileHandlers'

let tempFiles: TempFileService | undefined
let processRunner: ProcessRunner | undefined

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: '#f5f7fa',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  if (process.env.ELECTRON_RENDERER_URL) window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else window.loadFile(join(__dirname, '../renderer/index.html'))
  return window
}

app.whenReady().then(() => {
  const registry = new BackendRegistry(app.getAppPath())
  const runner = new ProcessRunner()
  processRunner = runner
  tempFiles = new TempFileService()
  const service = new ConversionService(registry, runner, tempFiles)
  registerBackendHandlers(registry)
  registerFileHandlers(service)
  registerConversionHandlers(service)
  ipcMain.handle('app:version', () => app.getVersion())
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => { processRunner?.cancelAll(); void tempFiles?.cleanup() })
