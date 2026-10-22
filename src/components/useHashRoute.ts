import { useEffect, useState } from 'react'

export type RouteName = 'checkpoint' | 'approvals' | 'alerts' | 'audit' | 'policy'
export interface Route {
  name: RouteName
  id?: string
}

function parse(): Route {
  const parts = window.location.hash.replace(/^#\/?/, '').split('/')
  const name = parts[0] as RouteName
  if (name === 'approvals') return { name, id: parts[1] }
  if (name === 'alerts') return { name }
  if (name === 'audit') return { name, id: parts[1] }
  if (name === 'policy' || name === 'checkpoint') return { name }
  return { name: 'checkpoint' }
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(parse)
  useEffect(() => {
    if (!window.location.hash) window.location.hash = '#/checkpoint'
    const on = () => setRoute(parse())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

export function useMediaQuery(query: string): boolean {
  const [m, setM] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setM(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return m
}
