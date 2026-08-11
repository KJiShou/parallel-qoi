import Bar from '@ant-design/plots/es/components/bar'
import Column from '@ant-design/plots/es/components/column'
import { Descriptions, Table, Tabs, Tag, Typography } from '@arco-design/web-react'
import type { ColumnProps } from '@arco-design/web-react/es/Table'
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import type { ConversionResponse } from '../services/electronApi'

const PhaseBar = Bar as unknown as ComponentType<Record<string, unknown>>

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
  phases: Record<string, number>
}

type TooltipRenderOptions = {
  title: string
  items: Array<{ name?: string; value?: unknown }>
}

type TooltipBounds = {
  x: number
  y: number
  width: number
  height: number
}

const PERFORMANCE_PHASES = [
  { key: 'load_ms', label: 'Input decode', color: '#aeb7c1' },
  { key: 'cuda_init_ms', label: 'CUDA init', color: '#d4dbe1' },
  { key: 'allocation_ms', label: 'GPU allocation', color: '#c4ccd4' },
  { key: 'summary_ms', label: 'Pass 1 / summary', color: '#9ba7b2' },
  { key: 'propagation_ms', label: 'Propagation', color: '#8997a4' },
  { key: 'transfer_in_ms', label: 'Transfer in', color: '#b9c98e' },
  { key: 'encode_ms', label: 'Pass 2 / encode', color: '#789a22' },
  { key: 'transfer_out_ms', label: 'Transfer out', color: '#94ad4d' },
  { key: 'merge_ms', label: 'Merge', color: '#b2bbc4' },
] as const

const PHASE_COLORS = PERFORMANCE_PHASES.map(({ color }) => color)
const BACKEND_COLORS = ['#aeb7c1', '#789a22', '#94ad4d', '#607f16']

// Until the first layout pass measures the chart, keep the tooltip from being
// constrained by the chart-local bounds. The effect below replaces this with
// the actual Electron-window viewport bounds as soon as the canvas exists.
const FALLBACK_TOOLTIP_BOUNDS: TooltipBounds = {
  x: -100000,
  y: -100000,
  width: 200000,
  height: 200000,
}

function finiteNonNegative(value: unknown) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0
}

function formatMs(value: unknown) {
  const numeric = Number(value)
  return `${(Number.isFinite(numeric) ? numeric : 0).toFixed(2)} ms`
}

function formatBytes(bytes: number) {
  return `${(bytes / 1024).toFixed(1)} KB`
}

function createPhaseTooltip(backend: string, phases: Record<string, number>) {
  const tooltip = document.createElement('div')
  tooltip.className = 'phase-tooltip'

  const title = document.createElement('div')
  title.className = 'phase-tooltip-title'
  title.textContent = backend || 'Performance phases'
  tooltip.appendChild(title)

  const list = document.createElement('div')
  list.className = 'phase-tooltip-list'
  for (const { key, label, color } of PERFORMANCE_PHASES) {
    const row = document.createElement('div')
    row.className = 'phase-tooltip-row'

    const marker = document.createElement('span')
    marker.className = 'phase-tooltip-marker'
    marker.style.backgroundColor = color

    const name = document.createElement('span')
    name.className = 'phase-tooltip-name'
    name.textContent = label

    const value = document.createElement('span')
    value.className = 'phase-tooltip-value'
    value.textContent = formatMs(phases[key] ?? 0)

    row.append(marker, name, value)
    list.appendChild(row)
  }
  tooltip.appendChild(list)
  return tooltip
}

function getSpeedup(response: ConversionResponse, serialEncode?: number) {
  const baseline = Number(serialEncode)
  const encode = Number(response.result.timing.encode_ms)
  if (!Number.isFinite(baseline) || baseline <= 0 || !Number.isFinite(encode) || encode <= 0) return undefined
  return baseline / encode
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

function ExpandedDetails({ response, serialEncode, serialBytes }: { response: ConversionResponse; serialEncode?: number; serialBytes?: number }) {
  const timing = response.result.timing
  const timingData: { label: string; value: string }[] = [
    ...PERFORMANCE_PHASES.map(({ key, label }) => ({ label, value: formatMs(timing[key]) })),
    { label: 'Prefix scan', value: formatMs(timing.prefix_scan_ms) },
  ]
  const totalData = [
    { label: 'Output write', value: formatMs(timing.write_ms) },
    { label: 'Metrics analysis (excluded)', value: formatMs(timing.metrics_analysis_ms) },
    { label: 'End-to-end total', value: formatMs(timing.total_ms) },
  ]
  const correctnessData = [
    { label: 'Validation time', value: formatMs(timing.validation_ms) },
    { label: 'Pixel match', value: response.result.validation.pixel_match ? 'PASS' : 'FAIL' },
    { label: 'SHA-256 match', value: response.result.validation.sha256_match ? 'PASS' : 'FAIL' },
  ]

  const configurationData = [
    ...getConfiguration(response),
    { label: 'Compression ratio', value: `${response.result.output.compression_ratio.toFixed(2)}×` },
  ]
  const speedup = getSpeedup(response, serialEncode)
  const workers = response.result.backend === 'openmp' || response.result.backend === 'mpi'
    ? response.result.configuration.threads
    : response.result.backend === 'serial' ? 1 : undefined
  const sizeOverhead = serialBytes && serialBytes > 0
    ? ((response.result.output.bytes - serialBytes) / serialBytes) * 100
    : undefined
  const researchData = [
    { label: 'Efficiency', value: speedup !== undefined && workers ? `${(speedup / workers).toFixed(3)} (${((speedup / workers) * 100).toFixed(2)}%)` : 'Not applicable' },
    { label: 'Size overhead vs Serial', value: sizeOverhead === undefined ? '—' : `${sizeOverhead.toFixed(3)}%` },
    { label: 'Inherited INDEX hits', value: response.result.cross_block.inherited_index_hits },
    { label: 'Fallback bytes avoided', value: response.result.cross_block.fallback_bytes_avoided },
  ]
  const chunkData = Object.entries(response.result.chunks).map(([name, value]) => ({ label: name.toUpperCase(), value }))

  return (
    <div className="expanded-details">
      <div>
        <Typography.Text className="expanded-details-title">Performance phase timing</Typography.Text>
        <Typography.Text type="secondary" className="expanded-details-note">Encode drives speedup. Input decode is host-side work; CUDA init and GPU allocation are setup phases. Performance phases exclude correctness validation.</Typography.Text>
        <Descriptions className="expanded-descriptions" data={timingData} column={{ xs: 1, sm: 2, md: 2, lg: 3 }} layout="vertical" tableLayout="fixed" size="small" border />
      </div>
      <div>
        <Typography.Text className="expanded-details-title">Correctness</Typography.Text>
        <Typography.Text type="secondary" className="expanded-details-note">Validation confirms that the generated QOI decodes back to the original pixels. It is not used for speedup or performance charts.</Typography.Text>
        <Descriptions className="expanded-descriptions" data={correctnessData} column={{ xs: 1, sm: 2, md: 2, lg: 3 }} layout="vertical" tableLayout="fixed" size="small" border />
      </div>
      <div>
        <Typography.Text className="expanded-details-title">End-to-end total</Typography.Text>
        <Typography.Text type="secondary" className="expanded-details-note">Includes native load, encode, output write, validation and preview, plus allocation and other native I/O overhead; excludes Electron, result JSON writing and metrics analysis.</Typography.Text>
        <Descriptions className="expanded-descriptions" data={totalData} column={{ xs: 1, sm: 2, md: 2, lg: 3 }} layout="vertical" tableLayout="fixed" size="small" border />
      </div>
      <div>
        <Typography.Text className="expanded-details-title">Research metrics</Typography.Text>
        <Typography.Text type="secondary" className="expanded-details-note">Efficiency applies to CPU threads and MPI processes. Cross-block counters are collected outside benchmark timing.</Typography.Text>
        <Descriptions className="expanded-descriptions" data={researchData} column={{ xs: 1, sm: 2, md: 2, lg: 3 }} layout="vertical" tableLayout="fixed" size="small" border />
      </div>
      <div>
        <Typography.Text className="expanded-details-title">QOI chunk distribution</Typography.Text>
        <Descriptions className="expanded-descriptions" data={chunkData} column={{ xs: 2, sm: 3, md: 3, lg: 3 }} layout="vertical" tableLayout="fixed" size="small" border />
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
  const [phaseTooltipBounds, setPhaseTooltipBounds] = useState<TooltipBounds>()
  const phaseChartRef = useRef<HTMLDivElement>(null)
  const serialEncode = responses.find((response) => response.result.backend === 'serial')?.result.timing.encode_ms
  const serialBytes = responses.find((response) => response.result.backend === 'serial')?.result.output.bytes
  const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const runtimeData = useMemo<RuntimeDatum[]>(() => responses.map((response) => ({
    backend: response.result.backend,
    value: finiteNonNegative(response.result.timing.encode_ms),
  })), [responses])

  const throughputData = useMemo<ThroughputDatum[]>(() => responses.map((response) => ({
    backend: response.result.backend,
    value: finiteNonNegative(response.result.output.throughput_mpixels),
    speedup: getSpeedup(response, serialEncode),
  })), [responses, serialEncode])

  const phaseValuesByBackend = useMemo<Record<string, Record<string, number>>>(() => Object.fromEntries(responses.map((response) => [
    response.result.backend,
    Object.fromEntries(PERFORMANCE_PHASES.map(({ key }) => [key, finiteNonNegative(response.result.timing[key])])),
  ])), [responses])

  const phaseData = useMemo<PhaseDatum[]>(() => responses.flatMap((response) => {
    const phases = phaseValuesByBackend[response.result.backend]
    return PERFORMANCE_PHASES.flatMap(({ key, label }) => {
      const value = phases[key]
      return value > 0 ? [{ backend: response.result.backend, phase: label, value, phases }] : []
    })
  }), [responses, phaseValuesByBackend])

  useEffect(() => {
    if (activeTab !== 'phases') {
      setPhaseTooltipBounds(undefined)
      return
    }

    const updatePhaseTooltipBounds = () => {
      const host = phaseChartRef.current
      if (!host || typeof window === 'undefined') return

      // G2 positions the pointer in the canvas' local coordinate system. The
      // canvas rectangle is therefore used to express the real window
      // viewport as a canvas-relative collision boundary.
      const canvas = host.querySelector('canvas')
      const canvasContainer = canvas?.parentElement ?? host
      const rect = canvasContainer.getBoundingClientRect()
      setPhaseTooltipBounds({
        x: -rect.left,
        y: -rect.top,
        width: window.innerWidth,
        height: window.innerHeight,
      })
    }

    updatePhaseTooltipBounds()
    const frame = window.requestAnimationFrame(updatePhaseTooltipBounds)
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(updatePhaseTooltipBounds)
      : undefined
    if (resizeObserver && phaseChartRef.current) resizeObserver.observe(phaseChartRef.current)

    window.addEventListener('resize', updatePhaseTooltipBounds)
    // Capture scroll events so scrolling any Electron document container keeps
    // the viewport-relative boundary in sync with the canvas.
    window.addEventListener('scroll', updatePhaseTooltipBounds, true)

    return () => {
      window.cancelAnimationFrame(frame)
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updatePhaseTooltipBounds)
      window.removeEventListener('scroll', updatePhaseTooltipBounds, true)
    }
  }, [activeTab, phaseData.length])

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
    tooltip: {
      items: [(datum: PhaseDatum) => ({ name: datum.backend, value: formatMs(datum.value) })],
    },
    interaction: {
      tooltip: {
        shared: false,
        series: false,
        mount: typeof document !== 'undefined' ? document.body : undefined,
        position: 'bottom-left',
        offset: [12, 12],
        bounding: phaseTooltipBounds ?? FALLBACK_TOOLTIP_BOUNDS,
        render: (_event: unknown, { items }: TooltipRenderOptions) => {
          const backend = String(items[0]?.name ?? '')
          return createPhaseTooltip(backend, phaseValuesByBackend[backend] ?? {})
        },
      },
    },
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
      title: 'Correctness',
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
          <div ref={phaseChartRef} className="performance-chart phase-performance-chart" role="img" aria-label="Phase timing breakdown chart">
            {phaseData.length ? <PhaseBar {...phaseConfig} /> : <div className="chart-empty">No phase timing was recorded.</div>}
          </div>
          <Typography.Text type="secondary" className="phase-chart-note">Input decode is host-side PNG/BMP work. CUDA init and GPU allocation are shown separately; validation is reported as a correctness check.</Typography.Text>
        </Tabs.TabPane>
      </Tabs>

      <div className="table-section-heading">
        <Typography.Text type="secondary">Benchmark summary</Typography.Text>
        <Typography.Text type="secondary">Expand a row for phase timing, correctness and configuration.</Typography.Text>
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
          expandedRowRender={(item) => <ExpandedDetails response={item} serialEncode={serialEncode} serialBytes={serialBytes} />}
          expandProps={{ width: 42, columnTitle: '' }}
        />
      </div>
    </div>
  )
}
