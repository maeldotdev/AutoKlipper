import {
  Captions, Clapperboard, Clock3, FolderKanban, LayoutDashboard, LayoutTemplate, Radio, Scissors, Settings as Cog,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  path: string
  label: string
  icon: LucideIcon
  shortcut?: string
}

export const NAV_MAIN: NavItem[] = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/auto-clipper', label: 'Auto Clipper', icon: Scissors },
  { path: '/live', label: 'Live Clipper', icon: Radio },
  { path: '/projects', label: 'Projects', icon: FolderKanban },
  { path: '/clips', label: 'My Clips', icon: Clapperboard },
  { path: '/caption-studio', label: 'Caption Studio', icon: Captions },
  { path: '/templates', label: 'Templates', icon: LayoutTemplate },
  { path: '/history', label: 'History', icon: Clock3 },
]
export const NAV_BOTTOM: NavItem = { path: '/settings', label: 'Settings', icon: Cog }
export const ALL_NAV = [...NAV_MAIN, NAV_BOTTOM]

/** Title and breadcrumb trail for the header. */
export function describeRoute(pathname: string): { title: string; crumbs: string[] } {
  if (pathname.startsWith('/editor')) return { title: 'Clip Editor', crumbs: ['My Clips', 'Clip Editor'] }
  const item = ALL_NAV.find((n) => pathname.startsWith(n.path))
  return { title: item?.label ?? 'AutoKlipper', crumbs: [] }
}
