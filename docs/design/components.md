# Components (GDM)

Base: Radix UI primitives (Dialog, Tabs, DropdownMenu/ContextMenu, Tooltip, Switch) + Tailwind roles from `tailwind.config.ts`. Icons: Lucide (MIT). Font: Inter (open). All copy written fresh. Light theme only for now (dark = could-have, needs its own contrast pass).

Global: focus-visible = 2px ring `accent`, 2px offset. Hit targets >= 32px. Motion uses `--motion-*` and respects reduced motion. Window min 800x520.

```
Button
  variants  primary (bg accent, text on-accent), secondary (bg surface, border), ghost, danger (bg danger, text on-accent)
  sizes     sm 28px, md 32px, lg 40px
  states    default, hover (darken 6%), active, focus-visible, disabled (50% opacity, no pointer), loading (spinner, label kept, aria-busy)
  tokens    radius md, text sm/500
  a11y      real <button>; icon-only buttons need aria-label + Tooltip
  used on   all

Toolbar (48px)
  items     Add URL, Resume, Pause, Delete, Settings; icon + label; separator
  states    item disabled when selection makes it invalid
  a11y      role=toolbar, arrow-key roving focus
  used on   S01

Sidebar filter list (200px)
  items     All, Downloading, Queued, Paused, Completed, Failed, each with count
  states    default, hover, selected (bg surface, accent bar left)
  a11y      role=listbox or nav with aria-current
  used on   S01, S07

Download table (row 36px)
  columns   name (icon + text, ellipsis), size, progress, speed, ETA, status, added; click header sorts
  states    empty (own empty state with Add URL button), selected, multi-select (ctrl/shift), hover, error row (danger text on status)
  a11y      role=grid, arrow keys move, Enter opens S03, Delete removes, space selects
  used on   S01, S07

Progress bar
  variants  simple (6px, accent on track), segmented (one block per connection, S03)
  states    running, paused (muted fill), error (danger), done (success)
  a11y      role=progressbar with aria-valuenow, never colour only: status text beside it
  used on   S01, S03

Dialog
  size      width 480, radius lg, shadow pop, scrim 40% black
  states    open, submitting, error (inline message, role=alert)
  a11y      Radix Dialog: focus trap, Esc closes, returns focus to opener
  used on   S02, S03, S04, delete confirm

Text input
  variants  url, folder (with Browse button), number
  states    default, hover, focus, filled, invalid (danger border + message), disabled
  tokens    border border-input (3.3:1), radius md, height 32
  a11y      label always visible, error linked by aria-describedby
  used on   S02, S04

Tabs
  items     General, Connections, Speed, Browser
  a11y      Radix Tabs, arrow keys
  used on   S04

Switch / checkbox
  states    off, on, focus, disabled
  a11y      Radix Switch with label
  used on   S04, S08

Context menu
  items     Open, Open folder, Pause, Resume, Retry, Copy link, Remove, Remove and delete file
  a11y      Radix ContextMenu, Shift+F10 opens
  used on   S01

Toast
  variants  success, error, info; auto-dismiss 5s, errors stay until dismissed
  a11y      role=status (error role=alert), pause on hover
  used on   S06 notifications, S01

Status bar (28px)
  content   total speed, active count, free disk space
  used on   S01

Media picker list
  rows      thumbnail-free: title, format badge, size, Download button
  states    loading, found, none ("no media found"), unsupported (DRM, with reason)
  used on   S05

Tray menu
  items     Open, Pause all, Resume all, Quit; native Electron menu
  used on   S06

Badge
  variants  neutral, success, danger, warning (always icon or text, never colour only)
  used on   S01, S05
```

Empty states to write fresh copy for: no downloads, no completed history, no media found, app not running (S08), engine error.
