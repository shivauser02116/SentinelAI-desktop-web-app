import { AppShell } from './components/AppShell'
import { SessionProvider } from './state/useSession'

export default function App() {
  return (
    <SessionProvider>
      <AppShell />
    </SessionProvider>
  )
}
