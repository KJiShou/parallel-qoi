import { useEffect, useState } from 'react'
import { ConfigProvider, Layout, Space, Tabs, Tag, Typography } from '@arco-design/web-react'
import type { BackendAvailability, SelectedImage } from './services/electronApi'
import { electronApi } from './services/electronApi'
import { ConvertPage } from './pages/ConvertPage'
import { ComparePage } from './pages/ComparePage'

type View = 'convert' | 'compare'

export function App() {
  const [view, setView] = useState<View>('convert')
  const [backends, setBackends] = useState<BackendAvailability[]>([])
  const [image, setImage] = useState<SelectedImage>()
  const [version, setVersion] = useState('0.1.0')

  useEffect(() => {
    void electronApi.detectBackends().then(setBackends)
    void electronApi.version().then(setVersion)
  }, [])

  const readyCount = backends.filter((backend) => backend.available).length
  const changeView = (next: View) => {
    setView(next)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  return (
    <ConfigProvider>
      <Layout className="app-shell">
        <Layout.Header className="topbar">
          <div className="brand"><span className="brand-mark">Q</span><Typography.Text className="brand-name">parallel<span className="brand-accent">/</span>qoi</Typography.Text></div>
          <Tabs
            activeTab={view}
            onChange={(value) => changeView(value as View)}
            className="main-navigation"
            type="line"
            size="small"
            headerPadding={false}
            animation={false}
            aria-label="Main navigation"
          >
            <Tabs.TabPane key="convert" title="Convert" />
            <Tabs.TabPane key="compare" title="Compare" />
          </Tabs>
          <div className="topbar-meta" role="status" aria-live="polite"><Space><Tag color={readyCount ? 'green' : 'gray'}>{readyCount} backends ready</Tag></Space></div>
        </Layout.Header>
        <Layout.Content>{view === 'convert' ? <ConvertPage backends={backends} image={image} onImage={setImage} /> : <ComparePage backends={backends} image={image} onImage={setImage} />}</Layout.Content>
        <Layout.Footer className="app-footer"><span>Parallel QOI Converter</span><span>v{version} · C++17 native core</span></Layout.Footer>
      </Layout>
    </ConfigProvider>
  )
}
