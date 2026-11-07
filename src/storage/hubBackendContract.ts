import { beforeAll, describe, expect, it } from 'vitest'
import { solvePow } from './pow'
import { commitmentOf, deriveEditKeys, hubProofFor, type EditKeys } from './keys'
import { HubExistsError, type HubBackend } from './hubBackend'

const HUB_ID = 'DDDDDDDDDDDDDDDDDDDDDD'
const SECRET = 'A'.repeat(43)

const sealed = (byte: number) => ({ iv: 'abcdefghijklmnop', ct: new Uint8Array([byte, 2, 3]) })
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Runs `check` on the value each time it is read, until it stops throwing. */
async function eventually<T>(read: () => Promise<T>, check: (value: T) => void): Promise<void> {
  const deadline = Date.now() + 4000
  for (;;) {
    const value = await read()
    try {
      check(value)
      return
    } catch (error) {
      if (Date.now() > deadline) throw error
      await sleep(50)
    }
  }
}

/** The behavior every hub backend must have, whether it is Firestore or in memory. */
export function describeHubBackend(make: () => HubBackend): void {
  describe('hub backend', () => {
    let keys: EditKeys
    let nonce: string
    const create = async (backend: HubBackend, byte = 1) =>
      backend.createHub(HUB_ID, sealed(byte), {
        nonce,
        next: await commitmentOf(await hubProofFor(keys.writeKey, HUB_ID, 2)),
      })
    /** Revision `rev`: reveals its proof and commits to the next one. */
    const update = async (backend: HubBackend, rev: number, byte = 1) =>
      backend.updateHub(HUB_ID, sealed(byte), {
        rev,
        proof: await hubProofFor(keys.writeKey, HUB_ID, rev),
        next: await commitmentOf(await hubProofFor(keys.writeKey, HUB_ID, rev + 1)),
      })

    beforeAll(async () => {
      keys = await deriveEditKeys(SECRET, HUB_ID)
      nonce = solvePow(HUB_ID)
    })

    it('creates, reads and updates a hub', async () => {
      const backend = make()
      expect(await backend.readHub(HUB_ID)).toBeNull()
      await create(backend)
      const first = await backend.readHub(HUB_ID)
      expect(first!.rev).toBe(1)
      expect(first!.sealed.iv).toBe('abcdefghijklmnop')
      expect([...first!.sealed.ct]).toEqual([1, 2, 3])
      expect(await update(backend, 2, 9)).toBe('ok')
      const second = await backend.readHub(HUB_ID)
      expect(second!.rev).toBe(2)
      expect([...second!.sealed.ct]).toEqual([9, 2, 3])
    })

    it('reports a conflict on a stale revision', async () => {
      const backend = make()
      await create(backend)
      expect(await update(backend, 2)).toBe('ok')
      expect(await update(backend, 2, 7)).toBe('conflict')
      const stored = await backend.readHub(HUB_ID)
      expect(stored!.rev).toBe(2)
      expect([...stored!.sealed.ct]).toEqual([1, 2, 3])
    })

    it('refuses a second create', async () => {
      const backend = make()
      await create(backend)
      await expect(create(backend, 5)).rejects.toBeInstanceOf(HubExistsError)
      expect([...(await backend.readHub(HUB_ID))!.sealed.ct]).toEqual([1, 2, 3])
    })

    it('delivers hub changes to a watcher', async () => {
      const backend = make()
      const seen: (number | null)[] = []
      const stop = backend.watchHub(HUB_ID, (hub) => seen.push(hub?.rev ?? null), (error) => { throw error })
      await eventually(async () => seen, (revs) => expect(revs.at(-1)).toBeNull())
      await create(backend)
      await eventually(async () => seen, (revs) => expect(revs.at(-1)).toBe(1))
      await update(backend, 2)
      await eventually(async () => seen, (revs) => expect(revs.at(-1)).toBe(2))
      stop()
    })
  })
}
