import { useCallback, useEffect, useState } from 'react'
import { startPow, type PowTask } from '../storage/powClient'

/** What `createDashboard` needs besides the content: the id and its proof of work. */
export interface PreparedDashboard {
  docId: string
  nonce: string
}

const never = new Promise<never>(() => {})

/**
 * Prepares one dashboard creation: a fresh id and its proof of work, found in the background.
 * `prepare` starts it on the first call and returns the same result afterwards. A failed
 * preparation is forgotten, and the next call starts over; `cancel` forgets it on demand.
 */
export function createPreparation(newDocId: () => Promise<string>, start: (docId: string) => PowTask) {
  let current: { prepared: Promise<PreparedDashboard>; cancel(): void } | undefined

  const prepare = (): Promise<PreparedDashboard> => {
    if (current) return current.prepared
    let cancelled = false
    let task: PowTask | undefined
    const prepared = newDocId().then((docId) => {
      if (cancelled) return never
      task = start(docId)
      return task.result.then((nonce) => ({ docId, nonce }))
    })
    const attempt = {
      prepared,
      cancel: () => {
        cancelled = true
        task?.cancel()
      },
    }
    // Also keeps a failure from being reported as unhandled before anyone awaits it.
    prepared.catch(() => {
      if (current === attempt) current = undefined
    })
    current = attempt
    return prepared
  }

  /** Stops the work; a later `prepare` starts afresh with a new id. */
  const cancel = () => {
    current?.cancel()
    current = undefined
  }

  return { prepare, cancel }
}

// Firestore is loaded only when someone is about to create a dashboard.
const newDocIdLazily = () => import('../storage/dashboardStore').then(({ newDocId }) => newDocId())

/**
 * The dashboard the page is about to create. Call `prepare` as soon as a creation is likely, and
 * await it to create; `ready` tells whether the proof of work is already found. Call `discard`
 * when a create fails: its write may have reached the server with that id, so the next attempt
 * needs a new one. The work stops when the page unmounts.
 */
export function usePreparedDashboard() {
  const [preparation] = useState(() => createPreparation(newDocIdLazily, startPow))
  const [ready, setReady] = useState(false)

  useEffect(() => () => preparation.cancel(), [preparation])

  const prepare = useCallback(() => {
    const prepared = preparation.prepare()
    prepared.then(
      () => setReady(true),
      () => setReady(false),
    )
    return prepared
  }, [preparation])

  const discard = useCallback(() => {
    preparation.cancel()
    setReady(false)
  }, [preparation])

  return { prepare, ready, discard }
}
