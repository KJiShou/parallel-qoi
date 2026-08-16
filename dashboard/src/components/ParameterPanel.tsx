import { Form, InputNumber, Space, Typography } from '@arco-design/web-react'
import type { BackendId } from '../../electron/services/types'

export type Parameters = { blocks: number; threads: number; segmentLength: number; cudaThreadsPerBlock: number }

type Props = {
  backend: BackendId
  value: Parameters
  onChange: (next: Parameters) => void
  showHeading?: boolean
}

export function ParameterPanel({ backend, value, onChange, showHeading = true }: Props) {
  const set = (key: keyof Parameters, next: number | undefined) => onChange({ ...value, [key]: Math.max(1, next ?? 1) })
  const setMpiProcesses = (next: number | undefined) => {
    const threads = Math.max(1, next ?? 1)
    onChange({ ...value, threads, blocks: Math.max(value.blocks, threads) })
  }
  return <Space direction="vertical" size={12} className="parameter-panel">
    {showHeading && <Typography.Text type="secondary" className="eyebrow">Backend parameters</Typography.Text>}
    {backend === 'serial' && <Typography.Text type="secondary">Fixed single-thread baseline; no tuning parameters.</Typography.Text>}
    <Form layout="vertical" className="parameter-form">
      {backend === 'openmp' && <Form.Item label="Threads"><InputNumber min={1} precision={0} value={value.threads} onChange={(next) => set('threads', next)} /></Form.Item>}
      {backend === 'openmp' && <Form.Item label="Image partitions"><InputNumber min={1} precision={0} value={value.blocks} onChange={(next) => set('blocks', next)} /></Form.Item>}
      {backend === 'cuda' && <Form.Item label="Pixels per segment"><InputNumber min={1} precision={0} value={value.segmentLength} onChange={(next) => set('segmentLength', next)} /></Form.Item>}
      {backend === 'cuda' && <Form.Item label="CUDA threads per block"><InputNumber min={32} max={1024} step={32} precision={0} value={value.cudaThreadsPerBlock} onChange={(next) => set('cudaThreadsPerBlock', next)} /></Form.Item>}
      {backend === 'cuda' && <Typography.Text type="secondary">The encoder derives the actual image partition count from the image size.</Typography.Text>}
      {backend === 'mpi' && <Form.Item label="Process count"><InputNumber min={1} precision={0} value={value.threads} onChange={setMpiProcesses} /></Form.Item>}
      {backend === 'mpi' && <Form.Item label="Image partitions"><InputNumber min={value.threads} precision={0} value={value.blocks} onChange={(next) => set('blocks', Math.max(value.threads, next ?? value.threads))} /></Form.Item>}
    </Form>
  </Space>
}
