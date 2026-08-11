import { existsSync } from 'node:fs'
import type { BackendRegistry } from './backendRegistry'
import { ProcessRunner } from './processRunner'
import { TempFileService } from './tempFileService'
import type { BackendId, ConversionRequest, ConversionResponse, NativeResult, SelectedImage } from './types'

function finiteNonNegative(value: unknown): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0
}

function normalizeResult(raw: Partial<NativeResult>, request: ConversionRequest, image: SelectedImage, job: { outputPath: string; previewPath: string }): NativeResult {
  const rawTiming = raw.timing
  const rawValidation = raw.validation
  const threads = request.backend === 'serial' ? 1 : (request.threads ?? 4)
  const segmentLength = Math.max(1, request.segmentLength ?? 1024)
  const requestedBlocks = Math.max(1, request.blocks ?? 8)
  const blocks = request.backend === 'serial'
    ? 1
    : request.backend === 'cuda'
      ? Math.ceil((image.width * image.height) / segmentLength)
      : request.backend === 'mpi' ? Math.max(requestedBlocks, threads) : requestedBlocks
  return {
    status: raw.status === 'success' || raw.status === 'validation_failed' ? raw.status : 'error',
    backend: raw.backend ?? request.backend,
    error: raw.error,
    input: raw.input ?? { path: image.inputPath, width: image.width, height: image.height, channels: image.channels },
    configuration: raw.configuration ?? { blocks, threads, segment_length: segmentLength },
    timing: {
      load_ms: finiteNonNegative(rawTiming?.load_ms),
      cuda_init_ms: finiteNonNegative(rawTiming?.cuda_init_ms),
      allocation_ms: finiteNonNegative(rawTiming?.allocation_ms),
      summary_ms: finiteNonNegative(rawTiming?.summary_ms),
      propagation_ms: finiteNonNegative(rawTiming?.propagation_ms),
      transfer_in_ms: finiteNonNegative(rawTiming?.transfer_in_ms),
      encode_ms: finiteNonNegative(rawTiming?.encode_ms),
      transfer_out_ms: finiteNonNegative(rawTiming?.transfer_out_ms),
      merge_ms: finiteNonNegative(rawTiming?.merge_ms),
      prefix_scan_ms: finiteNonNegative(rawTiming?.prefix_scan_ms),
      write_ms: finiteNonNegative(rawTiming?.write_ms),
      metrics_analysis_ms: finiteNonNegative(rawTiming?.metrics_analysis_ms),
      validation_ms: finiteNonNegative(rawTiming?.validation_ms),
      total_ms: finiteNonNegative(rawTiming?.total_ms),
    },
    output: raw.output ?? { path: job.outputPath, bytes: 0, compression_ratio: 0, throughput_mpixels: 0 },
    chunks: raw.chunks ?? { run: 0, index: 0, diff: 0, luma: 0, rgb: 0, rgba: 0 },
    cross_block: raw.cross_block ?? { inherited_index_hits: 0, fallback_bytes_avoided: 0 },
    preview_path: raw.preview_path ?? job.previewPath,
    validation: {
      passed: rawValidation?.passed ?? false,
      pixel_match: rawValidation?.pixel_match ?? false,
      sha256_match: rawValidation?.sha256_match ?? false,
    },
  }
}

export class ConversionService {
  private readonly selectedImages = new Map<string, SelectedImage>()
  private readonly results = new Map<string, NativeResult>()

  constructor(private readonly registry: BackendRegistry, private readonly runner: ProcessRunner, private readonly temp: TempFileService) {}

  registerImage(image: SelectedImage): void { this.selectedImages.set(image.id, image) }

  removeImage(imageId: string): void { this.selectedImages.delete(imageId) }

  image(imageId: string): SelectedImage | undefined { return this.selectedImages.get(imageId) }

  async convert(request: ConversionRequest): Promise<ConversionResponse> {
    const image = this.selectedImages.get(request.imageId)
    if (!image) throw new Error('selected image is no longer available')
    const executable = this.registry.executablePath(request.backend)
    if (!executable) throw new Error(`${request.backend} backend is not available on this machine`)
    const job = await this.temp.createJob(request.jobId)
    const threads = request.backend === 'serial' ? 1 : (request.threads ?? 4)
    const requestedBlocks = request.blocks ?? 8
    const blocks = request.backend === 'serial'
      ? 1
      : request.backend === 'mpi'
        ? Math.max(requestedBlocks, threads)
        : request.backend === 'cuda' ? 1 : requestedBlocks
    const args = [
      '--input', image.inputPath,
      '--output', job.outputPath,
      '--result', job.resultPath,
      '--preview', job.previewPath,
      '--threads', String(threads),
      '--segment-length', String(request.segmentLength ?? 1024),
      '--validate',
    ]
    if (request.backend !== 'cuda') args.push('--blocks', String(blocks))
    let command = executable
    let commandArgs = args
    if (request.backend === 'mpi') {
      const launcher = await this.registry.mpiLauncher()
      if (!launcher) throw new Error('mpiexec was not found on this machine')
      command = launcher
      commandArgs = ['-n', String(request.threads ?? 4), executable, ...args]
    }
    const result = normalizeResult(await this.runner.run(job.jobId, command, commandArgs, job.resultPath) as Partial<NativeResult>, request, image, job)
    const previewDataUrl = result.validation?.passed && existsSync(job.previewPath)
      ? await this.temp.previewDataUrl(job.jobId)
      : undefined
    this.results.set(job.jobId, result)
    return { jobId: job.jobId, result, previewDataUrl }
  }

  async compare(requests: ConversionRequest[]): Promise<ConversionResponse[]> {
    if (requests.length === 0) throw new Error('select at least one backend to compare')
    const serialIncluded = requests.some((request) => request.backend === 'serial')
    const ordered = serialIncluded ? requests : [{ ...requests[0], backend: 'serial' as BackendId }, ...requests]
    const responses: ConversionResponse[] = []
    for (const request of ordered) responses.push(await this.convert(request))
    return responses
  }

  cancel(jobId: string): boolean { return this.runner.cancel(jobId) }

  async save(jobId: string): Promise<string | undefined> {
    const result = this.results.get(jobId)
    if (!result?.validation.passed) throw new Error('QOI output did not pass validation and cannot be saved')
    return this.temp.save(jobId)
  }
}
