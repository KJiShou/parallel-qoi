import Bar from '@ant-design/plots/es/components/bar'
import Column from '@ant-design/plots/es/components/column'
import { Descriptions, Table, Tabs, Tag, Typography } from '@arco-design/web-react'
import type { ColumnProps } from '@arco-design/web-react/es/Table'
import { useMemo, useState } from 'react'
import type { ConversionResponse } from '../services/electronApi'

type ChartTab = 'runtime' | 'throughput' | 'phases'

type RuntimeDatum = {
  backend: string
  value: number
}

type ThroughputDatum = {
  backend: string
  value: number
  speedup?: number
}

type PhaseDatum = {
  backend: string
  phase: string
  value: number
}

const PHASES = [
  { key: 'load_ms', label: 'Load' },
  { key: 'summary_ms', label: 'Summary' },
  { key: 'propagation_ms', label: 'Propagation' },
  { key: 'transfer_in_ms', label: 'Transfer in' },
  { key: 'encode_ms', label: 'Encode' },
  { key: 'transfer_out_ms', label: 'Transfer out' },
  { key: 'merge_ms', label: 'Merge' },
  { key: 'validation_ms', label: 'Validation' },
] as const

const PHASE_COLORS = ['#aeb7c1', '#9ba7b2', '#8997a4', '#b9c98e', '#789a22', '#94ad4d', '#607f16', '#c4ccd4']
const BACKEND_COLORS = ['#aeb7c1', '#789a22', '#94ad4d', '#607f16']

function formatMs(value: number) {
  return `${value.toFixed(2)} ms`
}

function formatBytes(bytes: number) {
  return `${(bytes / 1024).toFixed(1)} KB`
}

function getSpeedup(response: ConversionResponse, serialEncode?: number) {
  if (!serialEncode || serialEncode <= 0 || response.result.timing.encode_ms <= 0) return undefined
  return serialEncode / response.result.timing.encode_ms
}

function getConfiguration(response: ConversionResponse) {
  const { backend, configuration } = response.result
  if (backend === 'serial') return [{ label: 'Execution', value: 'Fixed single-thread baseline' }]
  if (backend === 'openmp') {
    return [
      { label: 'Threads', value: configuration.threads },
      { label: 'Blocks', value: configuration.blocks },
    ]
  }
  if (backend === 'cuda') {
    return [
      { label: 'Segment length', value: configuration.segment_length },
      { label: 'Blocks', value: configuration.blocks },
    ]
  }
  return [{ label: 'Processes', value: configuration.threads }]
}

function ExpandedDetails({ response }: { response: ConversionResponse }) {
  const timing = response.result.timing
  const timingData: { label: string; value: string }[] = PHASES.map(({ key, label }) => ({ label, value: formatMs(timing[key]) }))
  const totalData = [{ label: 'End-to-end total', value: formatMs(timing.total_ms) }]

  const configurationData = [
    ...getConfiguration(response),
    { label: 'Compression ratio', value: `${response.result.output.compression_ratio.toFixed(2)}×` },
  ]

  return (
    <div className="expanded-details">
      <div>
        <Typography.Text className="expanded-details-title">Phase timing</Typography.Text>
        <Typography.Text type="secondary" className="expanded-details-note">Encode drives speedup. Phase values are reported independently; they are not expected to add up to the end-to-end total.</Typography.Text>
        <Descriptions className="expanded-descriptions" data={timingData} column={{ xs: 1, sm: 2, md: 2, lg: 3 }} layout="vertical" tableLayout="fixed" size="small" border />
      </div>
      <div>
        <Typography.Text className="expanded-details-title">End-to-end total</Typography.Text>
        <Typography.Text type="secondary" className="expanded-details-note">Includes native load, encode, output write, validation and preview, plus allocation and other native I/O overhead; excludes Electron and result JSON writing.</Typography.Text>
        <Descriptions className="expanded-descriptions" data={totalData} column={{ xs: 1, sm: 2, md: 2, lg: 3 }} layout="vertical" tableLayout="fixed" size="small" border />
      </div>
      <div>
        <Typography.Text className="expanded-details-title">Configuration</Typography.Text>
        <Descriptions className="expanded-descriptions" data={configurationData} column={{ xs: 1, sm: 2, md: 2, lg: 3 }} layout="vertical" tableLayout="fixed" size="small" border />
      </div>
    </div>
  )
}

export function PerformanceCharts({ responses }: { responses: ConversionResponse[] }) {
  const [activeTab, setActiveTab] = useState<ChartTab>('runtime')
  const serialEncode = responses.find((response) => response.result.backend === 'serial')?.result.timing.encode_ms
  const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const runtimeData = useMemo<RuntimeDatum[]>(() => responses.map((response) => ({
    backend: response.result.backend,
    value: Math.max(0, response.result.timing.encode_ms),
  })), [responses])

  const throughputData = useMemo<ThroughputDatum[]>(() => responses.map((response) => ({
    backend: response.result.backend,
    value: Math.max(0, response.result.output.throughput_mpixels),
    speedup: getSpeedup(response, serialEncode),
  })), [responses, serialEncode])

  const phaseData = useMemo<PhaseDatum[]>(() => responses.flatMap((response) => PHASES.flatMap(({ key, label }) => {
    const value = Math.max(0, response.result.timing[key])
    return value > 0 ? [{ backend: response.result.backend, phase: label, value }] : []
  })), [responses])

  const runtimeConfig = {
    data: runtimeData,
    xField: 'backend',
    yField: 'value',
    colorField: 'backend',
    height: 280,
    autoFit: true,
    animate: !prefersReducedMotion,
    legend: false,
    scale: { color: { domain: ['serial', 'openmp', 'cuda', 'mpi'], range: BACKEND_COLORS } },
    axis: {
      y: { title: 'Encode (ms)', labelFormatter: (value: string) => `${Number(value).toFixed(0)} ms` },
      x: { title: false },
    },
    tooltip: { items: [{ field: 'value', name: 'Encode', valueFormatter: (value: number) => formatMs(Number(value)) }] },
  }

  const throughputConfig = {
    data: throughputData,
    xField: 'backend',
    yField: 'value',
    colorField: 'backend',
    height: 280,
    autoFit: true,
    animate: !prefersReducedMotion,
    legend: false,
    scale: { color: { domain: ['serial', 'openmp', 'cuda', 'mpi'], range: BACKEND_COLORS } },
    axis: {
      y: { title: 'Throughput (MPix/s)', labelFormatter: (value: string) => `${Number(value).toFixed(0)} MPix/s` },
      x: { title: false },
    },
    tooltip: {
      items: [
        { field: 'value', name: 'Throughput', valueFormatter: (value: number) => `${Number(value).toFixed(2)} MPix/s` },
        { field: 'speedup', name: 'Speedup', valueFormatter: (value: number) => Number(value) > 0 ? `${Number(value).toFixed(2)}×` : '—' },
      ],
    },
  }

  const phaseConfig = {
    data: phaseData,
    xField: 'backend',
    yField: 'value',
    colorField: 'phase',
    stack: true,
    height: 280,
    autoFit: true,
    animate: !prefersReducedMotion,
    scale: { color: { range: PHASE_COLORS } },
    axis: {
      y: { title: 'Duration (ms)', labelFormatter: (value: string) => `${Number(value).toFixed(0)} ms` },
      x: { title: false },
    },
    tooltip: { items: [{ field: 'value', name: 'Duration', valueFormatter: (value: number) => formatMs(Number(value)) }] },
  }

  const columns: ColumnProps<ConversionResponse>[] = [
    {
      title: 'Backend',
      dataIndex: 'result.backend',
      width: 120,
      render: (_value: unknown, item: ConversionResponse) => <Tag color={item.result.backend === 'serial' ? 'gray' : 'green'}>{item.result.backend}</Tag>,
    },
    {
      title: 'Encode',
      width: 112,
      align: 'right',
      render: (_value: unknown, item: ConversionResponse) => <span className="table-number">{formatMs(item.result.timing.encode_ms)}</span>,
    },
    {
      title: 'Throughput',
      width: 145,
      align: 'right',
      render: (_value: unknown, item: ConversionResponse) => <span className="table-number">{item.result.output.throughput_mpixels.toFixed(2)} MPix/s</span>,
    },
    {
      title: 'Speedup',
      width: 105,
      align: 'right',
      render: (_value: unknown, item: ConversionResponse) => {
        const speedup = getSpeedup(item, serialEncode)
        if (speedup === undefined) return <span className="table-muted">—</span>
        return <Tag color={speedup >= 1 ? 'green' : 'gray'}>{speedup.toFixed(2)}×</Tag>
      },
    },
    {
      title: 'Output',
      width: 100,
      align: 'right',
      render: (_value: unknown, item: ConversionResponse) => <span className="table-number">{formatBytes(item.result.output.bytes)}</span>,
    },
    {
      title: 'Validation',
      width: 105,
      render: (_value: unknown, item: ConversionResponse) => <Tag color={item.result.validation.passed ? 'green' : 'red'}>{item.result.validation.passed ? 'PASS' : 'FAIL'}</Tag>,
    },
  ]

  return (
    <div className="performance-results">
      <Tabs activeTab={activeTab} onChange={(key) => setActiveTab(key as ChartTab)} className="performance-tabs" type="line" size="small" lazyload destroyOnHide animation={!prefersReducedMotion}>
        <Tabs.TabPane key="runtime" title="Runtime">
          <div className="performance-chart" role="img" aria-label="Runtime comparison chart">
            <Column {...runtimeConfig} />
          </div>
        </Tabs.TabPane>
        <Tabs.TabPane key="throughput" title="Throughput">
          <div className="performance-chart" role="img" aria-label="Throughput comparison chart">
            <Column {...throughputConfig} />
          </div>
        </Tabs.TabPane>
        <Tabs.TabPane key="phases" title="Phase breakdown">
          <div className="performance-chart" role="img" aria-label="Phase timing breakdown chart">
            {phaseData.length ? <Bar {...phaseConfig} /> : <div className="chart-empty">No phase timing was recorded.</div>}
          </div>
        </Tabs.TabPane>
      </Tabs>

      <div className="table-section-heading">
        <Typography.Text type="secondary">Summary</Typography.Text>
        <Typography.Text type="secondary">Expand a row for phase timing and configuration.</Typography.Text>
      </div>
      <div className="results-table-wrap">
        <Table
          className="performance-table"
          rowKey="jobId"
          columns={columns}
          data={responses}
          pagination={false}
          tableLayoutFixed
          border={{ wrapper: true, cell: true }}
          expandedRowRender={(item) => <ExpandedDetails response={item} />}
          expandProps={{ width: 42, columnTitle: '' }}
        />
      </div>
    </div>
  )
}
