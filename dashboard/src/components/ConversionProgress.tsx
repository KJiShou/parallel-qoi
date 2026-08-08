import { Progress, Space, Spin, Typography } from '@arco-design/web-react'

export function ConversionProgress({ active }: { active: boolean }) {
  return active ? <div className="conversion-progress" role="status" aria-live="polite"><Space direction="vertical" size={6}><Space><Spin size={16} /><Typography.Text>Encoding and validating output…</Typography.Text></Space><Progress percent={70} status="normal" /></Space></div> : null
}
