import { useMemo, useState } from 'react'
import { Alert, Button, Card, Checkbox, Grid, Space, Tag, Typography } from '@arco-design/web-react'
import type { BackendAvailability, BackendId, ConversionResponse, SelectedImage } from '../services/electronApi'
import { electronApi } from '../services/electronApi'
import { PerformanceCharts } from '../components/PerformanceCharts'
import { ImageDropZone } from '../components/ImageDropZone'
import { ParameterPanel, type Parameters } from '../components/ParameterPanel'

type Props = { backends: BackendAvailability[]; image?: SelectedImage; onImage: (image?: SelectedImage) => void }

const initialParameters: Parameters = { blocks: 8, threads: 4, segmentLength: 1024 }

const initialParametersByBackend: Record<BackendId, Parameters> = {
  serial: { ...initialParameters },
  openmp: { ...initialParameters },
  cuda: { ...initialParameters },
  mpi: { ...initialParameters },
}

export function ComparePage({ backends, image, onImage }: Props) {
  const available = useMemo(() => backends.filter((backend) => backend.available), [backends])
  const [selected, setSelected] = useState<BackendId[]>(['serial'])
  const [parametersByBackend, setParametersByBackend] = useState<Record<BackendId, Parameters>>(initialParametersByBackend)
  const [responses, setResponses] = useState<ConversionResponse[]>([])
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<string>()
  const toggle = (id: BackendId) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  const updateParameters = (backend: BackendId, next: Parameters) => {
    setParametersByBackend((current) => ({ ...current, [backend]: next }))
  }
  const choose = async () => { try { onImage(await electronApi.selectImage()); setResponses([]); setMessage(undefined) } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } }
  const drop = async (path: string) => { try { onImage(await electronApi.registerDroppedImage(path)); setResponses([]); setMessage(undefined) } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } }
  const compare = async () => {
    if (!image || selected.length === 0) return
    setRunning(true); setMessage(undefined); setResponses([])
    try {
      setResponses(await electronApi.compareBackends(selected.map((backend) => {
        const parameters = parametersByBackend[backend]
        return { imageId: image.id, backend, blocks: parameters.blocks, threads: parameters.threads, segmentLength: parameters.segmentLength }
      })))
    }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setRunning(false) }
  }
  const save = async (jobId: string) => { try { await electronApi.saveQoi(jobId) } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } }
  const { Row, Col } = Grid
  return <main className="page-shell compare-page">
    <section className="page-heading"><Typography.Text className="eyebrow">Controlled comparison</Typography.Text><Typography.Title heading={1}>See the same pixels move differently.</Typography.Title><Typography.Paragraph className="hero-copy">Run selected backends one after another. Serial is automatically added as the speedup baseline when needed.</Typography.Paragraph></section>
    <Row gutter={16} align="start">
      <Col xs={24} lg={8}>
        <Card bordered title="Input image"><ImageDropZone image={image} onChoose={choose} onDropPath={drop} /></Card>
        <Card bordered title="Backends to run" className="selection-card">
          <Space direction="vertical" size={12} className="compare-control-stack">
            {available.map((backend) => <Checkbox key={backend.id} checked={selected.includes(backend.id)} onChange={() => toggle(backend.id)}>{backend.label}</Checkbox>)}
            <div className="compare-parameter-list" aria-label="Backend parameters">
              {selected.length === 0 && <Typography.Text type="secondary">Select a backend to configure its parameters.</Typography.Text>}
              {selected.map((backend) => {
                const definition = backends.find((item) => item.id === backend)
                return <section className="compare-parameter-section" key={backend}>
                  <div className="compare-parameter-heading">
                    <Typography.Text className="backend-config-name">{definition?.label ?? backend}</Typography.Text>
                    <Tag color={backend === 'serial' ? 'gray' : 'green'}>{backend === 'serial' ? 'BASELINE' : 'CONFIGURATION'}</Tag>
                  </div>
                  <ParameterPanel backend={backend} value={parametersByBackend[backend]} onChange={(next) => updateParameters(backend, next)} showHeading={false} />
                </section>
              })}
            </div>
            <Button type="primary" long disabled={!image || running || selected.length === 0} loading={running} onClick={compare}>{running ? 'Running comparison…' : 'Run comparison'}</Button>
            {message && <Alert type="error" showIcon content={message} aria-live="polite" />}
          </Space>
        </Card>
      </Col>
      <Col xs={24} lg={16}>
        <Card bordered title="Benchmark results" extra={<Typography.Text type="secondary">Sequential benchmark</Typography.Text>}>
          {responses.length ? <div className="results-stack" aria-live="polite"><PerformanceCharts responses={responses} /><div className="results-actions">{responses.filter((response) => response.result.validation.passed).map((response) => <Button type="secondary" key={response.jobId} onClick={() => save(response.jobId)}>Save {response.result.backend} output</Button>)}{responses.every((response) => !response.result.validation.passed) && <Typography.Text type="secondary">Save is available after validation passes.</Typography.Text>}</div></div> : <div className="empty-results"><Typography.Title heading={5}>Results will appear here.</Typography.Title><Typography.Text type="secondary">Choose at least one available backend and start a run.</Typography.Text></div>}
        </Card>
      </Col>
    </Row>
  </main>
}
