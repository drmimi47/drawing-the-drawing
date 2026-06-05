/**
 * Top application menu bar — a slim header carrying the brand wordmark.
 *
 * The old "File" / "Document" placeholder dropdowns were removed (they performed no
 * actions); Export and the Program Sheet now live on the tool rail (Ribbon).
 *
 * Brand: a plain bold "Gradia" sans wordmark (no mark).
 */
export function MenuBar() {
  return (
    <header className="menu-bar" onPointerDown={(e) => e.stopPropagation()}>
      <span className="menu-bar-brand">Gradia</span>
    </header>
  )
}
