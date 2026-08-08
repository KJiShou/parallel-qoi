import { Radio, Space, Tag, Tooltip, Typography } from '@arco-design/web-react'
import type { BackendAvailability, BackendId } from '../../electron/services/types'

type Props = { backends: BackendAvailability[]; selected: BackendId; onSelect: (backend: BackendId) => void }

export function BackendSelector({ backends, selected, onSelect }: Props) {
  return <Radio.Group value={selected} onChange={(value) => onSelect(value as BackendId)}>
    <Space direction="vertical" size={8} className="backend-list">
      {backends.map((backend) => <Tooltip key={backend.id} content={backend.available ? `${backend.label} is ready` : backend.reason} position="right">
        <Radio value={backend.id} disabled={!backend.available} className="backend-option">
          <Space direction="vertical" size={2}>
            <Typography.Text className="backend-label">{backend.label}</Typography.Text>
            <Typography.Text type="secondary">{backend.available ? 'Ready' : backend.reason}</Typography.Text>
          </Space>
          <Tag color={backend.available ? 'green' : 'gray'} size="small">{backend.available ? 'READY' : 'OFFLINE'}</Tag>
        </Radio>
      </Tooltip>)}
    </Space>
  </Radio.Group>
}
