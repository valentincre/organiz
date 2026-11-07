import type { Time } from './types'

/** Duration in minutes given to an event that has a start but no end. */
export const DEFAULT_DURATION = 60

const DAY_MINUTES = 24 * 60

export interface DayItem {
  id: string
  start: Time
  end?: Time
}

export interface PlacedItem {
  id: string
  /** Minutes from midnight. */
  top: number
  /** Minutes. */
  height: number
  /** 0-based column inside its overlap cluster. */
  column: number
  /** Number of columns of its overlap cluster. */
  columns: number
}

interface Span {
  id: string
  start: number
  end: number
  /** End of the drawn block, at least `minHeight` after the start. */
  visualEnd: number
}

/** "18:30" → 1110. */
export function toMinutes(time: Time): number {
  const [hours, minutes] = time.split(':')
  return Number(hours) * 60 + Number(minutes)
}

function toSpan(item: DayItem, minHeight: number): Span {
  const start = Math.min(toMinutes(item.start), DAY_MINUTES)
  const rawEnd = item.end === undefined ? start + DEFAULT_DURATION : toMinutes(item.end)
  const end = Math.min(Math.max(rawEnd, start), DAY_MINUTES)
  const visualEnd = Math.min(Math.max(end, start + minHeight), DAY_MINUTES)
  return { id: item.id, start, end, visualEnd }
}

function compareSpans(a: Span, b: Span): number {
  if (a.start !== b.start) return a.start - b.start
  if (a.end !== b.end) return b.end - a.end
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Places timed events on a vertical day timeline: transitively overlapping
 * events form a cluster and share its width side by side.
 */
export function layoutDay(items: DayItem[], minHeight = 20): PlacedItem[] {
  const spans = items.map((item) => toSpan(item, minHeight)).sort(compareSpans)
  const placed: PlacedItem[] = []
  let cluster: PlacedItem[] = []
  let columnEnds: number[] = []
  let clusterEnd = -1

  const closeCluster = () => {
    for (const item of cluster) item.columns = columnEnds.length
    cluster = []
    columnEnds = []
  }

  for (const span of spans) {
    if (span.start >= clusterEnd) closeCluster()
    let column = columnEnds.findIndex((end) => end <= span.start)
    if (column === -1) column = columnEnds.length
    columnEnds[column] = span.visualEnd
    clusterEnd = Math.max(clusterEnd, span.visualEnd)
    const item = { id: span.id, top: span.start, height: span.visualEnd - span.start, column, columns: 1 }
    cluster.push(item)
    placed.push(item)
  }
  closeCluster()
  return placed
}

/** Hour (0–23) the timeline scrolls to: one hour before the earliest event. */
export function firstHourToShow(items: DayItem[], fallbackHour = 7): number {
  if (items.length === 0) return fallbackHour
  const earliest = Math.min(...items.map((item) => toMinutes(item.start)))
  return Math.min(23, Math.max(0, Math.floor(earliest / 60) - 1))
}
