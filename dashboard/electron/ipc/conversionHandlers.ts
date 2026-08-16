import { ipcMain } from 'electron'
import type { ConversionService } from '../services/conversionService'
import type { ConversionRequest } from '../services/types'

export function registerConversionHandlers(service: ConversionService): void {
  ipcMain.handle('conversion:convert', (_event, request: ConversionRequest) => service.convert(request))
  ipcMain.handle('conversion:compare', (_event, requests: ConversionRequest[]) => service.compare(requests))
  ipcMain.handle('conversion:save', (_event, jobId: string) => service.save(jobId))
  ipcMain.handle('conversion:cancel', (_event, jobId: string) => service.cancel(jobId))
}

