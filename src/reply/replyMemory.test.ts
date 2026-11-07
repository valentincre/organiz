import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/** The parts of Storage the reply memory uses, kept in a map. */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  } as Storage
}

/** Storage in private mode or with site data blocked: every access throws. */
function throwingStorage(): Storage {
  const blocked = () => {
    throw new Error('SecurityError')
  }
  return { getItem: blocked, setItem: blocked, removeItem: blocked } as unknown as Storage
}

/** A fresh copy of the module, as after a page reload. */
const reload = async () => {
  vi.resetModules()
  return import('./replyMemory')
}

afterAll(() => vi.unstubAllGlobals())

describe('reply memory', () => {
  let storage: Storage
  let memory: Awaited<ReturnType<typeof reload>>
  beforeAll(async () => {
    storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    memory = await reload()
  })

  it('keeps one device id', () => {
    const { deviceId } = memory
    expect(deviceId()).toBe(deviceId())
    expect(deviceId()).toMatch(/^[A-Za-z0-9_-]{22}$/)
  })

  it('keeps the device id across reloads', async () => {
    const id = memory.deviceId()
    expect((await reload()).deviceId()).toBe(id)
  })

  it('remembers several names per link, latest answer each', () => {
    const { rememberAnswer, answeredFor } = memory
    rememberAnswer('s1', 'p1', 'yes', 1)
    rememberAnswer('s1', 'p2', 'no', 2)
    rememberAnswer('s1', 'p1', 'none', 3)
    expect(answeredFor('s1')).toEqual([
      { personId: 'p1', answer: 'none', at: 3 },
      { personId: 'p2', answer: 'no', at: 2 },
    ])
    expect(answeredFor('s2')).toEqual([])
  })

  it('remembers check-ins', () => {
    memory.rememberAnswer('s3', 'p1', 'here', 1)
    memory.rememberAnswer('s3', 'p2', 'here', 2)
    memory.rememberAnswer('s3', 'p2', 'notHere', 3)
    expect(memory.answeredFor('s3')).toEqual([
      { personId: 'p2', answer: 'notHere', at: 3 },
      { personId: 'p1', answer: 'here', at: 1 },
    ])
  })

  it('remembers the names across reloads', async () => {
    expect((await reload()).answeredFor('s1')).toEqual(memory.answeredFor('s1'))
  })

  it('forgets the names of a link', () => {
    memory.rememberAnswer('s2', 'p3', 'yes', 4)
    memory.forgetNames('s1')
    expect(memory.answeredFor('s1')).toEqual([])
    expect(memory.answeredFor('s2')).toEqual([{ personId: 'p3', answer: 'yes', at: 4 }])
  })

  it('ignores what it cannot read', () => {
    storage.setItem('organiz.reply.bad', '{not json')
    storage.setItem('organiz.reply.odd', JSON.stringify({ p1: { answer: 'maybe', at: 1 }, 'bad id!': { answer: 'yes', at: 1 }, p2: { answer: 'no', at: 2 } }))
    expect(memory.answeredFor('bad')).toEqual([])
    expect(memory.answeredFor('odd')).toEqual([{ personId: 'p2', answer: 'no', at: 2 }])
  })
})

describe('reply memory without storage', () => {
  it('works without storage', async () => {
    vi.stubGlobal('localStorage', throwingStorage())
    const { deviceId, rememberAnswer, answeredFor, forgetNames } = await reload()
    expect(deviceId()).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(deviceId()).toBe(deviceId())
    rememberAnswer('s1', 'p1', 'yes', 1)
    rememberAnswer('s1', 'p2', 'no', 2)
    expect(answeredFor('s1')).toEqual([
      { personId: 'p2', answer: 'no', at: 2 },
      { personId: 'p1', answer: 'yes', at: 1 },
    ])
    forgetNames('s1')
    expect(answeredFor('s1')).toEqual([])
  })

  it('works where reading localStorage itself throws', async () => {
    vi.stubGlobal('localStorage', undefined)
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError')
      },
    })
    const { deviceId, rememberAnswer, answeredFor } = await reload()
    expect(deviceId()).toBe(deviceId())
    rememberAnswer('s1', 'p1', 'no', 5)
    expect(answeredFor('s1')).toEqual([{ personId: 'p1', answer: 'no', at: 5 }])
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: undefined })
  })
})
