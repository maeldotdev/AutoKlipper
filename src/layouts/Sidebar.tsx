import { NavLink } from 'react-router-dom'
import { Code2, Heart, PanelLeftClose, PanelLeftOpen, type LucideIcon } from 'lucide-react'
import { openLink, type OutsideLink } from '@/lib/links'
import { NAV_BOTTOM, NAV_MAIN, type NavItem } from '@/app/routes'
import { Logo } from '@/components/Logo'
import { Tip } from '@/components/ui/Tooltip'
import { useSettings } from '@/stores/settings'
import { cn } from '@/lib/utils'
import { IS_MOCK_BACKEND } from '@/services'

function Item({ item, collapsed, index }: { item: NavItem; collapsed: boolean; index?: number }) {
  const link = (
    <NavLink
      to={item.path}
      aria-label={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          'no-drag group relative flex h-9 items-center gap-3 rounded-md px-3 text-body transition-colors duration-150',
          collapsed && 'justify-center px-0',
          isActive ? 'bg-s3 text-t1' : 'text-t2 hover:bg-s2 hover:text-t1',
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            aria-hidden
            className={cn(
              'absolute -left-3 top-2 bottom-2 w-[3px] rounded-r-full bg-accent transition-opacity duration-150',
              isActive ? 'opacity-100' : 'opacity-0',
            )}
          />
          <item.icon size={18} className={isActive ? 'text-accent' : ''} />
          {collapsed ? null : <span className="truncate">{item.label}</span>}
          {!collapsed && index !== undefined ? (
            <span className="ml-auto font-mono text-meta text-t3 opacity-0 transition-opacity duration-150 group-hover:opacity-100">Ctrl {index}</span>
          ) : null}
        </>
      )}
    </NavLink>
  )
  return collapsed ? (
    <Tip label={item.label} side="right" kbd={index ? `Ctrl ${index}` : undefined}>
      {link}
    </Tip>
  ) : (
    link
  )
}

/** Leaves the app: opens in the user's own browser. */
function LinkItem({ which, label, icon: Icon, collapsed }: { which: OutsideLink; label: string; icon: LucideIcon; collapsed: boolean }) {
  const button = (
    <button
      type="button"
      onClick={() => openLink(which)}
      aria-label={`${label}, opens in your browser`}
      className={cn('no-drag flex h-9 items-center gap-3 rounded-md px-3 text-body text-t2 transition-colors duration-150 hover:bg-s2 hover:text-t1', collapsed && 'justify-center px-0')}
    >
      <Icon size={18} />
      {collapsed ? null : <span className="truncate">{label}</span>}
    </button>
  )
  return collapsed ? <Tip label={label} side="right">{button}</Tip> : button
}

export function Sidebar() {
  const collapsed = useSettings((s) => s.sidebarCollapsed)
  const set = useSettings((s) => s.set)
  return (
    <aside
      aria-label="Primary"
      className="flex shrink-0 flex-col border-r border-line bg-chrome px-3 pb-3 pt-4 transition-[width] duration-200 ease-out"
      style={{ width: collapsed ? 68 : 'var(--sidebar-w)' }}
    >
      <div className={cn('mb-5 flex items-center gap-2.5 px-1', collapsed && 'justify-center px-0')}>
        <Logo size={28} />
        {collapsed ? null : <span className="text-section font-semibold">AutoKlipper</span>}
      </div>

      <nav className="flex flex-col gap-0.5" aria-label="Main">
        {NAV_MAIN.map((n, i) => (
          <Item key={n.path} item={n} collapsed={collapsed} index={i + 1} />
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-0.5">
        {collapsed || !IS_MOCK_BACKEND ? null : (
          <div className="mb-2 rounded-md border border-line bg-s1 p-3">
            <p className="text-label font-medium">Prototype build</p>
            <p className="mt-0.5 text-meta text-t3">Sample data only. No video is processed yet.</p>
          </div>
        )}
        <LinkItem which="kofi" label="Support on Ko-fi" icon={Heart} collapsed={collapsed} />
        <LinkItem which="github" label="GitHub" icon={Code2} collapsed={collapsed} />
        <Item item={NAV_BOTTOM} collapsed={collapsed} index={9} />
        <Tip label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} side="right" kbd="Ctrl B">
          <button
            onClick={() => set({ sidebarCollapsed: !collapsed })}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              'no-drag flex h-9 items-center gap-3 rounded-md px-3 text-body text-t3 transition-colors duration-150 hover:bg-s2 hover:text-t1',
              collapsed && 'justify-center px-0',
            )}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            {collapsed ? null : <span>Collapse</span>}
          </button>
        </Tip>
      </div>
    </aside>
  )
}
