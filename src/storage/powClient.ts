import { solvePow } from './pow'

export interface PowTask {
  /**
   * Resolves with the nonce. It never settles once the task is cancelled. A failure is not
   * reported as unhandled while nobody awaits it, since the work starts long before it is needed.
   */
  result: Promise<string>
  cancel(): void
}

/** Searches for the creation nonce off the main thread, falling back to it where no worker can run. */
export function startPow(docId: string): PowTask {
  const worker = createWorker()
  if (!worker) {
    let timer: ReturnType<typeof setTimeout> | undefined
    const result = new Promise<string>((resolve) => {
      timer = setTimeout(() => resolve(solvePow(docId)), 0)
    })
    return { result, cancel: () => clearTimeout(timer) }
  }

  const result = new Promise<string>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<{ nonce: string }>) => {
      worker.terminate()
      resolve(event.data.nonce)
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(event.error ?? new Error(event.message))
    }
  })
  // Marks the rejection as handled; whoever awaits `result` later still gets it.
  result.catch(() => {})
  worker.postMessage(docId)
  return { result, cancel: () => worker.terminate() }
}

/** The worker, or nothing where workers are missing or refused (e.g. by a Content Security Policy). */
function createWorker(): Worker | undefined {
  if (typeof Worker === 'undefined') return undefined
  try {
    return new Worker(new URL('./pow.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return undefined
  }
}
