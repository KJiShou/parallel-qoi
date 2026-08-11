import { Form, InputNumber, Space, Typography } from '@arco-design/web-react'
import type { BackendId } from '../../electron/services/types'

export type Parameters = { blocks: number; threads: number; segmentLength: number }

type Props = {
  backend: BackendId
  value: Parameters
  onChange: (next: Parameters) => void
  showHeading?: boolean
}

export function ParameterPanel({ backend, value, onChange, showHeading = true }: Props) {
  const set = (key: keyof Parameters, next: number | undefined) => onChange({ ...value, [key]: Math.max(1, next ?? 1) })
  return <Space direction="vertical" size={12} className="parameter-panel">
    {showHeading && <Typography.Text type="secondary" className="eyebrow">Backend parameters</Typography.Text>}
    {backend === 'serial' && <Typography.Text type="secondary">Fixed single-thread baseline; no tuning parameters.</Typography.Text>}
    <Form layout="vertical" className="parameter-form">
      {(backend === 'openmp' || backend === 'cuda') && <Form.Item label="Block count"><InputNumber min={1} value={value.blocks} onChange={(next) => set('blocks', next)} /></Form.Item>}
      {backend === 'openmp' && <Form.Item label="Threads"><InputNumber min={1} value={value.threads} onChange={(next) => set('threads', next)} /></Form.Item>}
      {backend === 'cuda' && <Form.Item label="Segment length"><InputNumber min={1} value={value.segmentLength} onChange={(next) => set('segmentLength', next)} /></Form.Item>}
      {backend === 'mpi' && <Form.Item label="Process count"><InputNumber min={1} value={value.threads} onChange={(next) => set('threads', next)} /></Form.Item>}
    </Form>
  </Space>
}
