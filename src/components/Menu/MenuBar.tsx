import { useEffect, useState } from 'react'

/**
 * Top application menu bar (Bluebeam / desktop-app style). "File" and "Document"
 * open snappy, non-rounded dropdown lists. The items are placeholders for now —
 * they close the menu without performing an action.
 *
 * Brand: a plain bold "GradiaDraw" sans wordmark (no mark).
 */

const MENUS: { label: string; items: string[] }[] = [
  { label: 'File', items: ['New', 'Open…', 'Save', 'Save As…', 'Export as PNG…', 'Close'] },
  { label: 'Document', items: ['Page Setup…', 'Document Properties…', 'Insert Page', 'Rotate Page'] },
]

export function MenuBar() {
  const [open, setOpen] = useState<string | null>(null)

  // Close any open dropdown on an outside click.
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  return (
    <header className="menu-bar" onPointerDown={(e) => e.stopPropagation()}>
      <span className="menu-bar-brand">GradiaDraw</span>

      <nav className="menu-bar-menus">
        {MENUS.map(({ label, items }) => (
          <div className="menu-root" key={label}>
            <button
              type="button"
              className={`menu-root-btn${open === label ? ' is-open' : ''}`}
              // Click toggles; hovering another root while a menu is open switches to it.
              onClick={() => setOpen((o) => (o === label ? null : label))}
              onMouseEnter={() => setOpen((o) => (o !== null ? label : o))}
            >
              {label}
            </button>
            {open === label && (
              <div className="menu-dropdown" role="menu">
                {items.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className="menu-dropdown-item"
                    role="menuitem"
                    onClick={() => setOpen(null)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>
    </header>
  )
}
