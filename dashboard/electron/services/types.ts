export type BackendId = 'serial' | 'openmp' | 'cuda' | 'mpi'

export type BackendAvailability = {
  id: BackendId
  label: string
  available: boolean
  reason?: string
}

export type SelectedImage = {
  id: string
  name: string
  size: number
  inputPath: string
  previewDataUrl: string
  width: number
  height: number
  channels: number
}

export type ConversionRequest = {
  imageId: string
  jobId?: string
  backend: BackendId
  blocks?: number
  threads?: number
  segmentLength?: number
}

export type NativeResult = {
  status: 'success' | 'validation_failed' | 'error'
  backend: BackendId
  error?: string
  input: { path: string; width: number; height: number; channels: number }
  configuration: { blocks: number; threads: number; segment_length: number }
  timing: {
    load_ms: number
    summary_ms: number
    propagation_ms: number
    transfer_in_ms: number
    encode_ms: number
    transfer_out_ms: number
    merge_ms: number
    validation_ms: number
    total_ms: number
  }
  output: { path: string; bytes: number; compression_ratio: number; throughput_mpixels: number }
  preview_path: string
  validation: { passed: boolean; pixel_match: boolean; sha256_match: boolean }
}

export type ConversionResponse = {
  jobId: string
  result: NativeResult
  previewDataUrl?: string
}
