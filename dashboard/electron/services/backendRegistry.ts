import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import type { BackendAvailability, BackendId } from './types'

const definitions: Array<{ id: BackendId; label: string; executable: string }> = [
  { id: 'serial', label: 'Serial baseline', executable: 'pqoi_serial' },
  { id: 'openmp', label: 'OpenMP', executable: 'pqoi_openmp' },
  { id: 'cuda', label: 'CUDA', executable: 'pqoi_cuda' },
  { id: 'mpi', label: 'MPI', executable: 'pqoi_mpi' },
]

const executableName = (name: string) => process.platform === 'win32' ? `${name}.exe` : name

export class BackendRegistry {
  private readonly projectRoot: string
  private readonly locations: string[]

  constructor(appPath: string) {
    this.projectRoot = resolve(appPath)
    const roots = [this.projectRoot, resolve(this.projectRoot, '..'), resolve(this.projectRoot, '..', '..'), resolve(this.projectRoot, '..', '..', '..')]
    this.locations = roots.flatMap((root) => [
      resolve(root, 'build', 'Release'),
      resolve(root, 'build-msvc', 'Release'),
      resolve(root, 'build-full', 'Release'),
      resolve(root, 'build'),
      resolve(root, 'dist', 'native'),
    ])
    this.locations.push(resolve(process.resourcesPath, 'native'))
  }

  executablePath(backend: BackendId): string | undefined {
    const definition = definitions.find((item) => item.id === backend)
    if (!definition) return undefined
    const name = executableName(definition.executable)
    return this.locations.map((location) => join(location, name)).find((path) => existsSync(path))
  }

  async detect(): Promise<BackendAvailability[]> {
    const mpiLauncher = await this.findCommand(process.platform === 'win32' ? 'mpiexec.exe' : 'mpiexec')
    const cudaProbe = await this.findCommand(process.platform === 'win32' ? 'nvidia-smi.exe' : 'nvidia-smi')
    const cudaReady = cudaProbe ? await this.commandSucceeds(cudaProbe, ['--query-gpu=name', '--format=csv,noheader']) : false
    const openmpPath = this.executablePath('openmp')
    const openmpReady = openmpPath ? await this.commandSucceeds(openmpPath, ['--help']) : false
    return definitions.map((definition) => {
      const path = this.executablePath(definition.id)
      if (definition.id === 'cuda' && !path) {
        return { id: definition.id, label: definition.label, available: false, reason: 'CUDA executable is not built' }
      }
      if (definition.id === 'cuda' && !cudaReady) {
        return { id: definition.id, label: definition.label, available: false, reason: 'CUDA-compatible NVIDIA GPU not detected' }
      }
      if (definition.id === 'openmp' && !openmpReady) {
        return { id: definition.id, label: definition.label, available: false, reason: 'OpenMP runtime is unavailable' }
      }
      if (definition.id === 'mpi' && (!path || !mpiLauncher)) {
        return { id: definition.id, label: definition.label, available: false, reason: !path ? 'MPI executable is not built' : 'mpiexec was not found' }
      }
      return path
        ? { id: definition.id, label: definition.label, available: true }
        : { id: definition.id, label: definition.label, available: false, reason: 'Native executable is not built' }
    })
  }

  async mpiLauncher(): Promise<string | undefined> {
    return this.findCommand(process.platform === 'win32' ? 'mpiexec.exe' : 'mpiexec')
  }

  private async findCommand(command: string): Promise<string | undefined> {
    const checker = process.platform === 'win32' ? 'where' : 'which'
    return new Promise((resolvePath) => {
      const child = spawn(checker, [command], { windowsHide: true })
      let output = ''
      child.stdout.on('data', (chunk) => { output += chunk.toString() })
      child.on('close', (code) => resolvePath(code === 0 ? output.trim().split(/\r?\n/)[0] : undefined))
      child.on('error', () => resolvePath(undefined))
    })
  }

  private async commandSucceeds(command: string, args: string[]): Promise<boolean> {
    return new Promise((resolveSuccess) => {
      const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
      let output = ''
      child.stdout.on('data', (chunk) => { output += chunk.toString() })
      child.on('close', (code) => resolveSuccess(code === 0 && output.trim().length > 0))
      child.on('error', () => resolveSuccess(false))
    })
  }
}
