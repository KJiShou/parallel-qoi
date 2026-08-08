import { spawn, type ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'

export class ProcessRunner {
  private readonly processes = new Map<string, ChildProcess>()

  async run(jobId: string, executable: string, args: string[], resultPath: string): Promise<Record<string, unknown>> {
    const result = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
      const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      this.processes.set(jobId, child)
      let stderr = ''
      child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })
      child.on('error', (error) => reject(error))
      child.on('close', (code) => resolve({ code, stderr }))
    }).finally(() => { this.processes.delete(jobId) })

    let parsed: Record<string, unknown> = {}
    try {
      parsed = JSON.parse(await readFile(resultPath, 'utf8')) as Record<string, unknown>
    } catch {
      parsed = { status: 'error', error: result.stderr || `native process exited with code ${result.code}` }
    }
    if (result.code !== 0 && parsed.status === 'success') {
      parsed.status = 'error'
      parsed.error = result.stderr || `native process exited with code ${result.code}`
    }
    return parsed
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
  }
}
