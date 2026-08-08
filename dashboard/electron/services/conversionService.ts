import { existsSync } from 'node:fs'
import type { BackendRegistry } from './backendRegistry'
import { ProcessRunner } from './processRunner'
import { TempFileService } from './tempFileService'
import type { BackendId, ConversionRequest, ConversionResponse, NativeResult, SelectedImage } from './types'

function normalizeResult(raw: Partial<NativeResult>, request: ConversionRequest, image: SelectedImage, job: { outputPath: string; previewPath: string }): NativeResult {
  const rawTiming = raw.timing
  const rawValidation = raw.validation
  return {
    status: raw.status === 'success' || raw.status === 'validation_failed' ? raw.status : 'error',
    backend: raw.backend ?? request.backend,
    error: raw.error,
    input: raw.input ?? { path: image.inputPath, width: image.width, height: image.height, channels: image.channels },
    configuration: raw.configuration ?? { blocks: request.blocks ?? 8, threads: request.threads ?? 4, segment_length: request.segmentLength ?? 1024 },
    timing: {
      load_ms: rawTiming?.load_ms ?? 0,
      summary_ms: rawTiming?.summary_ms ?? 0,
      propagation_ms: rawTiming?.propagation_ms ?? 0,
      transfer_in_ms: rawTiming?.transfer_in_ms ?? 0,
      encode_ms: rawTiming?.encode_ms ?? 0,
      transfer_out_ms: rawTiming?.transfer_out_ms ?? 0,
      merge_ms: rawTiming?.merge_ms ?? 0,
      validation_ms: rawTiming?.validation_ms ?? 0,
      total_ms: rawTiming?.total_ms ?? 0,
    },
    output: raw.output ?? { path: job.outputPath, bytes: 0, compression_ratio: 0, throughput_mpixels: 0 },
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
    const blocks = request.backend === 'serial' ? 1 : (request.blocks ?? 8)
    const threads = request.backend === 'serial' ? 1 : (request.threads ?? 4)
    const args = [
      '--input', image.inputPath,
      '--output', job.outputPath,
      '--result', job.resultPath,
      '--preview', job.previewPath,
      '--blocks', String(blocks),
      '--threads', String(threads),
      '--segment-length', String(request.segmentLength ?? 1024),
      '--validate',
    ]
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
