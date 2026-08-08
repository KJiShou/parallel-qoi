import { Card, Grid, Image, Typography } from '@arco-design/web-react'
import type { SelectedImage } from '../services/electronApi'

export function ImageComparison({ source, decoded }: { source?: SelectedImage; decoded?: string }) {
  const { Row, Col } = Grid
  return <Row gutter={12} className="comparison-grid">
    <Col span={12}><Card title="Source" bordered><div className="preview-frame">{source ? <Image src={source.previewDataUrl} alt="Source preview" preview={false} /> : <Typography.Text type="secondary">Upload an image</Typography.Text>}</div></Card></Col>
    <Col span={12}><Card title="Decoded QOI" bordered><div className="preview-frame">{decoded ? <Image src={decoded} alt="Decoded QOI preview" preview={false} /> : <Typography.Text type="secondary">Run a conversion</Typography.Text>}</div></Card></Col>
  </Row>
}
