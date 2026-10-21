import { useCallback, useState } from 'react'
import { useSession } from '../state/useSession'
import { ApprovalScreen } from '../screens/ApprovalScreen'
import { AuditScreen } from '../screens/AuditScreen'
import { CheckpointScreen } from '../screens/CheckpointScreen'
import { PolicyScreen } from '../screens/PolicyScreen'
import { AboutDialog } from './AboutDialog'
import { Toast } from './Toast'
import { TopBar } from './TopBar'
import { useHashRoute } from './useHashRoute'

export function AppShell() {
  const route = useHashRoute()
  const { liveMessage } = useSession()
  const [about, setAbout] = useState(false)
  const closeAbout = useCallback(() => setAbout(false), [])

  return (
    <div className="flex h-full flex-col">
      <TopBar route={route.name} onAbout={() => setAbout(true)} />
      <main className="min-h-0 flex-1">
        {route.name === 'checkpoint' && <CheckpointScreen />}
        {route.name === 'approvals' && <ApprovalScreen id={route.id} />}
        {route.name === 'audit' && <AuditScreen />}
        {route.name === 'policy' && <PolicyScreen />}
      </main>
      <Toast />
      {about && <AboutDialog onClose={closeAbout} />}
      <div aria-live="polite" className="sr-only">
        {liveMessage}
      </div>
    </div>
  )
}
