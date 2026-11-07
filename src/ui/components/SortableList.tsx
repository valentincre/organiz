import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { cx } from './styles'
import { GripIcon } from './icons'

interface Props<T extends { id: string }> {
  items: T[]
  /** Called with every id in the new order once a move ends. */
  onReorder: (ids: string[]) => void
  /** Accessible name of an item's handle, e.g. "Move Position". */
  handleLabel: (item: T) => string
  /** The item's row; `handle` goes where the user should grab it. */
  renderItem: (item: T, handle: ReactNode, dragging: boolean) => ReactNode
  className?: string
}

/**
 * A list whose items are reordered by dragging their ⋮⋮ handle (mouse, pen
 * or finger) or, with the handle focused, by the up and down arrow keys.
 */
export function SortableList<T extends { id: string }>({ items, onReorder, handleLabel, renderItem, className }: Props<T>) {
  const list = useRef<HTMLUListElement>(null)
  const [drag, setDrag] = useState<{ id: string; order: string[] } | null>(null)
  const byId = new Map(items.map((item) => [item.id, item]))
  const order = drag?.order.filter((id) => byId.has(id)) ?? items.map((item) => item.id)

  const start = (event: PointerEvent<HTMLButtonElement>, id: string) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({ id, order: items.map((item) => item.id) })
  }

  // The dragged item takes the place of the row under the pointer.
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag || !list.current) return
    const rows = [...list.current.children] as HTMLElement[]
    let target = rows.length - 1
    for (const [index, row] of rows.entries()) {
      const rect = row.getBoundingClientRect()
      if (event.clientY < rect.top + rect.height / 2) {
        target = index
        break
      }
    }
    const current = drag.order.indexOf(drag.id)
    if (target === current) return
    const next = drag.order.filter((id) => id !== drag.id)
    next.splice(target, 0, drag.id)
    setDrag({ ...drag, order: next })
  }

  const end = () => {
    if (drag && drag.order.join() !== items.map((item) => item.id).join()) onReorder(drag.order)
    setDrag(null)
  }

  const nudge = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const ids = items.map((item) => item.id)
    const index = ids.indexOf(id)
    const target = index + (event.key === 'ArrowUp' ? -1 : 1)
    if (target < 0 || target >= ids.length) return
    ids.splice(index, 1)
    ids.splice(target, 0, id)
    onReorder(ids)
  }

  return (
    <ul ref={list} className={className}>
      {order.map((id) => {
        const item = byId.get(id)!
        const dragging = drag?.id === id
        const handle = (
          <button
            type="button"
            className={cx(
              'inline-flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted select-none hover:bg-surface-muted hover:text-text',
              dragging && 'cursor-grabbing text-text',
            )}
            aria-label={handleLabel(item)}
            title={handleLabel(item)}
            onPointerDown={(event) => start(event, id)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={() => setDrag(null)}
            onKeyDown={(event) => nudge(event, id)}
          >
            <GripIcon small />
          </button>
        )
        return <li key={id}>{renderItem(item, handle, dragging)}</li>
      })}
    </ul>
  )
}
