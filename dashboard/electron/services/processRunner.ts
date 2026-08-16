import { spawn, type ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createInterface, type Interface } from 'node:readline'

export class ProcessRunner {
  private readonly processes = new Map<string, ChildProcess>()
  private cudaWorker?: ChildProcess
  private cudaLines?: Interface
  private cudaExecutable?: string
  private cudaQueue: Promise<void> = Promise.resolve()

  private async readResult(resultPath: string, fallbackError: string): Promise<Record<string, unknown>> {
    try {
      return JSON.parse(await readFile(resultPath, 'utf8')) as Record<string, unknown>
    } catch {
      return { status: 'error', error: fallbackError }
    }
  }

  async run(jobId: string, executable: string, args: string[], resultPath: string): Promise<Record<string, unknown>> {
    const result = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
      const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      this.processes.set(jobId, child)
      let stderr = ''
      child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })
      child.on('error', (error) => reject(error))
      child.on('close', (code) => resolve({ code, stderr }))
    }).finally(() => { this.processes.delete(jobId) })

    const parsed = await this.readResult(resultPath, result.stderr || `native process exited with code ${result.code}`)
    if (result.code !== 0 && parsed.status === 'success') {
      parsed.status = 'error'
      parsed.error = result.stderr || `native process exited with code ${result.code}`
    }
    return parsed
  }

  private stopCudaWorker(): void {
    this.cudaLines?.close()
    this.cudaLines = undefined
    if (this.cudaWorker && !this.cudaWorker.killed) this.cudaWorker.kill()
    this.cudaWorker = undefined
    this.cudaExecutable = undefined
  }

  private ensureCudaWorker(executable: string): { child: ChildProcess; lines: Interface } {
    if (this.cudaWorker && this.cudaLines && this.cudaExecutable === executable && !this.cudaWorker.killed) {
      return { child: this.cudaWorker, lines: this.cudaLines }
    }
    this.stopCudaWorker()
    const child = spawn(executable, ['--server'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const lines = createInterface({ input: child.stdout! })
    this.cudaWorker = child
    this.cudaLines = lines
    this.cudaExecutable = executable
    child.once('exit', () => {
      if (this.cudaWorker === child) {
        this.cudaWorker = undefined
        this.cudaLines = undefined
        this.cudaExecutable = undefined
      }
    })
    return { child, lines }
  }

  private async runCudaUnlocked(jobId: string, executable: string, request: Record<string, unknown>, resultPath: string): Promise<Record<string, unknown>> {
    let lastError = 'CUDA worker failed'
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const { child, lines } = this.ensureCudaWorker(executable)
        this.processes.set(jobId, child)
        const response = await new Promise<Record<string, unknown>>((resolve, reject) => {
          const onLine = (line: string) => {
            cleanup()
            try { resolve(JSON.parse(line) as Record<string, unknown>) }
            catch { reject(new Error(`CUDA worker returned invalid JSON: ${line}`)) }
          }
          const onExit = () => { cleanup(); reject(new Error('CUDA worker exited before returning a result')) }
          const onError = (error: Error) => { cleanup(); reject(error) }
          const cleanup = () => {
            lines.off('line', onLine)
            child.off('exit', onExit)
            child.off('error', onError)
          }
          lines.once('line', onLine)
          child.once('exit', onExit)
          child.once('error', onError)
          child.stdin?.write(`${JSON.stringify(request)}\n`, (error) => { if (error) onError(error) })
        })
        if (response.status === 'error') lastError = String(response.error ?? lastError)
        const parsed = await this.readResult(resultPath, lastError)
        this.processes.delete(jobId)
        return parsed
      } catch (error) {
        this.processes.delete(jobId)
        lastError = error instanceof Error ? error.message : String(error)
        this.stopCudaWorker()
      }
    }
    return { status: 'error', error: lastError }
  }

  async runCuda(jobId: string, executable: string, request: Record<string, unknown>, resultPath: string): Promise<Record<string, unknown>> {
    const previous = this.cudaQueue
    let release!: () => void
    this.cudaQueue = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      return await this.runCudaUnlocked(jobId, executable, request, resultPath)
    } finally {
      release()
    }
  }

  cancel(jobId: string): boolean {
    const child = this.processes.get(jobId)
    if (!child) return false
    if (process.platform === 'win32' && child.pid) {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      killer.unref()
      return true
    }
    return child.kill('SIGTERM')
  }

  cancelAll(): void {
    for (const jobId of this.processes.keys()) this.cancel(jobId)
    this.stopCudaWorker()
  }
}
