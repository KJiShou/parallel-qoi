import { mkdir, mkdtemp, readFile, rm, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { app, dialog } from 'electron'

export type JobPaths = { jobId: string; directory: string; outputPath: string; resultPath: string; previewPath: string }

export class TempFileService {
  private readonly jobs = new Map<string, JobPaths>()
  private rootPromise?: Promise<string>

  async createJob(requestedJobId?: string): Promise<JobPaths> {
    const root = await this.root()
    const jobId = requestedJobId && /^[0-9a-f-]{36}$/i.test(requestedJobId) ? requestedJobId : randomUUID()
    const directory = await mkdtemp(join(root, `${jobId}-`))
    const job = { jobId, directory, outputPath: join(directory, 'output.qoi'), resultPath: join(directory, 'result.json'), previewPath: join(directory, 'decoded.bmp') }
    this.jobs.set(jobId, job)
    return job
  }

  get(jobId: string): JobPaths | undefined { return this.jobs.get(jobId) }

  async previewDataUrl(jobId: string): Promise<string | undefined> {
    const job = this.jobs.get(jobId)
    if (!job) return undefined
    const bytes = await readFile(job.previewPath)
    return `data:image/bmp;base64,${bytes.toString('base64')}`
  }

  async save(jobId: string): Promise<string | undefined> {
    const job = this.jobs.get(jobId)
    if (!job) throw new Error('conversion job was not found')
    const selected = await dialog.showSaveDialog({
      title: 'Save QOI image',
      defaultPath: 'converted.qoi',
      filters: [{ name: 'Quite OK Image', extensions: ['qoi'] }],
    })
    if (selected.canceled || !selected.filePath) return undefined
    await copyFile(job.outputPath, selected.filePath)
    return selected.filePath
  }

  async cleanup(): Promise<void> {
    for (const job of this.jobs.values()) await rm(job.directory, { recursive: true, force: true })
    this.jobs.clear()
  }

  private async root(): Promise<string> {
    this.rootPromise ??= (async () => {
      const root = join(app.getPath('temp'), 'parallel-qoi')
      await mkdir(root, { recursive: true })
      return root
    })()
    return this.rootPromise
  }
}
