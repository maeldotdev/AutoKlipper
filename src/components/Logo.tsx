export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--surface-3)" />
      <path d="M9 8h5.2a4 4 0 0 1 0 8H12v8H9z" fill="var(--accent)" />
      <path d="M17.5 17.5 23 24" stroke="var(--cyan)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
