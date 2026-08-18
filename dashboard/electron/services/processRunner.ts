import { spawn, type ChildProcess } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { readFile } from 'node:fs/promises'
import { createInterface, type Interface } from 'node:readline'

type Orchestration = {
  request_wall_ms: number
  worker_startup_ms: number
  worker_reused: boolean
  input_cache_reused: boolean
  fallback_used: boolean
}

function withOrchestration(result: Record<string, unknown>, orchestration: Orchestration): Record<string, unknown> {
  return { ...result, __orchestration: orchestration }
}

function emptyOrchestration(requestWall = 0): Orchestration {
  return {
    request_wall_ms: requestWall,
    worker_startup_ms: 0,
    worker_reused: false,
    input_cache_reused: false,
    fallback_used: false,
  }
}

export class ProcessRunner {
  private readonly processes = new Map<string, ChildProcess>()
  private readonly cancelledJobs = new Set<string>()

  private cudaWorker?: ChildProcess
  private cudaLines?: Interface
  private cudaExecutable?: string
  private cudaQueue: Promise<void> = Promise.resolve()

  private mpiWorker?: ChildProcess
  private mpiLines?: Interface
  private mpiExecutable?: string
  private mpiLauncher?: string
  private mpiProcesses?: number
  private mpiQueue: Promise<void> = Promise.resolve()
  private mpiIdleTimer?: NodeJS.Timeout

  private async readResult(resultPath: string, fallbackError: string): Promise<Record<string, unknown>> {
    try {
      return JSON.parse(await readFile(resultPath, 'utf8')) as Record<string, unknown>
    } catch {
      return { status: 'error', error: fallbackError }
    }
  }

  async run(jobId: string, executable: string, args: string[], resultPath: string): Promise<Record<string, unknown>> {
    const started = performance.now()
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
    return withOrchestration(parsed, emptyOrchestration(performance.now() - started))
  }

  private stopCudaWorker(): void {
    this.cudaLines?.close()
    this.cudaLines = undefined
    if (this.cudaWorker && !this.cudaWorker.killed) this.cudaWorker.kill()
    this.cudaWorker = undefined
    this.cudaExecutable = undefined
  }

  private ensureCudaWorker(executable: string): { child: ChildProcess; lines: Interface; reused: boolean; startupMs: number } {
    if (this.cudaWorker && this.cudaLines && this.cudaExecutable === executable && !this.cudaWorker.killed) {
      return { child: this.cudaWorker, lines: this.cudaLines, reused: true, startupMs: 0 }
    }
    this.stopCudaWorker()
    const started = performance.now()
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
    return { child, lines, reused: false, startupMs: performance.now() - started }
  }

  private async runCudaUnlocked(jobId: string, executable: string, request: Record<string, unknown>, resultPath: string): Promise<Record<string, unknown>> {
    const started = performance.now()
    let lastError = 'CUDA worker failed'
    let startupMs = 0
    let workerReused = false
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const worker = this.ensureCudaWorker(executable)
        startupMs += worker.startupMs
        workerReused = workerReused || worker.reused
        const { child, lines } = worker
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
        this.cancelledJobs.delete(jobId)
        return withOrchestration(parsed, {
          ...emptyOrchestration(performance.now() - started),
          worker_startup_ms: startupMs,
          worker_reused: workerReused,
          input_cache_reused: parsed.configuration !== undefined && (parsed.configuration as Record<string, unknown>).input_cache_reused === true,
          fallback_used: false,
        })
      } catch (error) {
        this.processes.delete(jobId)
        lastError = error instanceof Error ? error.message : String(error)
        this.stopCudaWorker()
        if (this.cancelledJobs.delete(jobId)) {
          return withOrchestration({ status: 'error', error: 'conversion cancelled' }, {
            ...emptyOrchestration(performance.now() - started),
            worker_startup_ms: startupMs,
            worker_reused: workerReused,
          })
        }
      }
    }
    return withOrchestration({ status: 'error', error: lastError }, {
      ...emptyOrchestration(performance.now() - started),
      worker_startup_ms: startupMs,
      worker_reused: workerReused,
    })
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

  private stopMpiWorker(): void {
    this.mpiIdleTimer && clearTimeout(this.mpiIdleTimer)
    this.mpiIdleTimer = undefined
    this.mpiLines?.close()
    this.mpiLines = undefined
    if (this.mpiWorker && !this.mpiWorker.killed) {
      if (process.platform === 'win32' && this.mpiWorker.pid) {
        const killer = spawn('taskkill.exe', ['/PID', String(this.mpiWorker.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        killer.unref()
      } else {
        this.mpiWorker.kill('SIGTERM')
      }
    }
    this.mpiWorker = undefined
    this.mpiExecutable = undefined
    this.mpiLauncher = undefined
    this.mpiProcesses = undefined
  }

  private scheduleMpiIdleShutdown(): void {
    this.mpiIdleTimer && clearTimeout(this.mpiIdleTimer)
    this.mpiIdleTimer = setTimeout(() => this.stopMpiWorker(), 5 * 60 * 1000)
    this.mpiIdleTimer.unref?.()
  }

  private ensureMpiWorker(executable: string, launcher: string, processes: number): { child: ChildProcess; lines: Interface; reused: boolean; startupMs: number } {
    if (this.mpiWorker && this.mpiLines && this.mpiExecutable === executable && this.mpiLauncher === launcher && this.mpiProcesses === processes && !this.mpiWorker.killed) {
      return { child: this.mpiWorker, lines: this.mpiLines, reused: true, startupMs: 0 }
    }
    this.stopMpiWorker()
    const started = performance.now()
    const child = spawn(launcher, ['-n', String(processes), executable, '--server'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const lines = createInterface({ input: child.stdout! })
    this.mpiWorker = child
    this.mpiLines = lines
    this.mpiExecutable = executable
    this.mpiLauncher = launcher
    this.mpiProcesses = processes
    child.once('exit', () => {
      if (this.mpiWorker === child) {
        this.mpiWorker = undefined
        this.mpiLines = undefined
        this.mpiExecutable = undefined
        this.mpiLauncher = undefined
        this.mpiProcesses = undefined
      }
    })
    return { child, lines, reused: false, startupMs: performance.now() - started }
  }

  private async runMpiUnlocked(jobId: string, executable: string, launcher: string, processes: number,
                               request: Record<string, unknown>, resultPath: string,
                               fallbackArgs: string[]): Promise<Record<string, unknown>> {
    const started = performance.now()
    let lastError = 'MPI worker failed'
    let startupMs = 0
    let workerReused = false
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const worker = this.ensureMpiWorker(executable, launcher, processes)
        startupMs += worker.startupMs
        workerReused = workerReused || worker.reused
        const { child, lines } = worker
        this.processes.set(jobId, child)
        const response = await new Promise<Record<string, unknown>>((resolve, reject) => {
          const onLine = (line: string) => {
            cleanup()
            try { resolve(JSON.parse(line) as Record<string, unknown>) }
            catch { reject(new Error(`MPI worker returned invalid JSON: ${line}`)) }
          }
          const onExit = () => { cleanup(); reject(new Error('MPI worker exited before returning a result')) }
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
        if (response.request_id !== undefined && String(response.request_id) !== String(request.request_id)) {
          throw new Error('MPI worker response request_id did not match the queued request')
        }
        const parsed = await this.readResult(resultPath, String(response.error ?? 'MPI worker did not produce a result'))
        this.processes.delete(jobId)
        this.cancelledJobs.delete(jobId)
        this.scheduleMpiIdleShutdown()
        const configuration = parsed.configuration as Record<string, unknown> | undefined
        return withOrchestration(parsed, {
          ...emptyOrchestration(performance.now() - started),
          worker_startup_ms: startupMs,
          worker_reused: workerReused,
          input_cache_reused: configuration?.input_cache_reused === true,
          fallback_used: false,
        })
      } catch (error) {
        this.processes.delete(jobId)
        lastError = error instanceof Error ? error.message : String(error)
        this.stopMpiWorker()
        if (this.cancelledJobs.delete(jobId)) {
          return withOrchestration({ status: 'error', error: 'conversion cancelled' }, {
            ...emptyOrchestration(performance.now() - started),
            worker_startup_ms: startupMs,
            worker_reused: workerReused,
          })
        }
      }
    }

    const fallback = await this.run(jobId, launcher, fallbackArgs, String(request.result))
    const fallbackMeta = fallback.__orchestration as Partial<Orchestration> | undefined
    delete fallback.__orchestration
    return withOrchestration(fallback, {
      ...emptyOrchestration(performance.now() - started),
      worker_startup_ms: startupMs + Number(fallbackMeta?.worker_startup_ms ?? 0),
      worker_reused: workerReused,
      fallback_used: true,
    })
  }

  async runMpi(jobId: string, executable: string, launcher: string, processes: number,
               request: Record<string, unknown>, resultPath: string,
               fallbackArgs: string[]): Promise<Record<string, unknown>> {
    const previous = this.mpiQueue
    let release!: () => void
    this.mpiQueue = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      return await this.runMpiUnlocked(jobId, executable, launcher, processes, request, resultPath, fallbackArgs)
    } finally {
      release()
    }
  }

  cancel(jobId: string): boolean {
    const child = this.processes.get(jobId)
    if (!child) return false
    this.cancelledJobs.add(jobId)
    if (child === this.mpiWorker) this.stopMpiWorker()
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
    this.stopMpiWorker()
  }
}
