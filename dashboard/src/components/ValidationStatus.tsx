import { Tag } from '@arco-design/web-react'
import type { NativeResult } from '../../electron/services/types'

export function ValidationStatus({ result }: { result?: NativeResult }) {
  if (!result) return <Tag color="gray" role="status" aria-live="polite">Awaiting conversion</Tag>
  if (result.validation?.passed) return <Tag color="green" role="status" aria-live="polite">Validated · pixels match</Tag>
  return <Tag color="red" role="status" aria-live="polite">Validation failed{result.error ? ` · ${result.error}` : ''}</Tag>
}
