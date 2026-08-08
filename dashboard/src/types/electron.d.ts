import type { BackendAvailability, ConversionRequest, ConversionResponse, SelectedImage } from '../../electron/services/types'

declare global {
  interface Window {
    pqoi: {
      selectImage(): Promise<SelectedImage | undefined>
      registerDroppedImage(inputPath: string): Promise<SelectedImage>
      detectBackends(): Promise<BackendAvailability[]>
      convertImage(request: ConversionRequest): Promise<ConversionResponse>
      compareBackends(requests: ConversionRequest[]): Promise<ConversionResponse[]>
      saveQoi(jobId: string): Promise<string | undefined>
      cancelConversion(jobId: string): Promise<boolean>
      version(): Promise<string>
    }
  }
}

export {}
