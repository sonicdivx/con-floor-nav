import { useId, useState, type ReactNode } from 'react'

type Props = {
  title: string
  /** Extra muted text in the header (e.g. party code / counts). */
  summary?: string
  defaultOpen?: boolean
  children: ReactNode
}

/** Collapsible section — closed by default to keep sheets compact on phones. */
export function NavCollapsible({
  title,
  summary,
  defaultOpen = false,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()

  return (
    <section className={`nav-collapsible${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="nav-collapsible-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="nav-collapsible-chevron" aria-hidden="true" />
        <span className="nav-collapsible-title">
          <strong>{title}</strong>
          {summary ? <span className="muted sm">{summary}</span> : null}
        </span>
      </button>
      {open && (
        <div id={panelId} className="nav-collapsible-body">
          {children}
        </div>
      )}
    </section>
  )
}
