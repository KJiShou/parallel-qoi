import type { BackendAvailability, BackendId, ConversionRequest, ConversionResponse, SelectedImage } from '../../electron/services/types'

export const electronApi = {
  selectImage: () => window.pqoi.selectImage(),
  registerDroppedImage: (path: string) => window.pqoi.registerDroppedImage(path),
  detectBackends: () => window.pqoi.detectBackends(),
  convertImage: (request: ConversionRequest) => window.pqoi.convertImage(request),
  compareBackends: (requests: ConversionRequest[]) => window.pqoi.compareBackends(requests),
  saveQoi: (jobId: string) => window.pqoi.saveQoi(jobId),
  cancelConversion: (jobId: string) => window.pqoi.cancelConversion(jobId),
  version: () => window.pqoi.version(),
}

export type { BackendAvailability, BackendId, ConversionRequest, ConversionResponse, SelectedImage }
