import { useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { Desktop } from './pages/Desktop'
import { Plugins } from './pages/Plugins'
import { Settings } from './pages/Settings'
import { Profile } from './pages/Profile'

export type PageKey = 'desktop' | 'plugins' | 'settings' | 'profile'

export default function App() {
  const [page, setPage] = useState<PageKey>('desktop')
  return (
    <div className="app-shell">
      <Sidebar page={page} onNavigate={setPage} />
      <main className="main">
        {page === 'desktop' && <Desktop />}
        {page === 'plugins' && <Plugins />}
        {page === 'settings' && <Settings />}
        {page === 'profile' && <Profile onNavigate={setPage} />}
      </main>
    </div>
  )
}
