import { randomId } from '../domain/ids'
import type { IncomingReply } from '../domain/replies'
import type { PersonId } from '../domain/types'
import { isId } from '../domain/validate'

// What a respondent's phone keeps about reply links, in localStorage:
//   "organiz.device"            a random id sent with every reply, so organizers can tell
//                               when two phones answered for the same person;
//   "organiz.reply.<shareId>"   the names this phone answered for on a link, with the
//                               latest answer each: { [personId]: { answer, at } }.
// Every access can throw (private mode, blocked or full storage), so a value that
// cannot be stored stays in memory for the life of the page.

const DEVICE_KEY = 'organiz.device'
const PREFIX = 'organiz.reply.'
const ANSWERS = new Set<unknown>(['yes', 'no', 'none', 'here', 'notHere'])

type Answer = IncomingReply['answer']

export interface Answered {
  personId: PersonId
  answer: Answer
  at: number
}

/** Values that could not be stored; they win over the stored ones. `null` stands for a removed value. */
const memory = new Map<string, string | null>()

function read(key: string): string | null {
  if (memory.has(key)) return memory.get(key) ?? null
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
    memory.delete(key)
  } catch {
    memory.set(key, value)
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key)
    memory.delete(key)
  } catch {
    memory.set(key, null)
  }
}

/** This phone's id: 16 random bytes, created once. */
export function deviceId(): string {
  const stored = read(DEVICE_KEY)
  if (stored !== null && /^[A-Za-z0-9_-]{22}$/.test(stored)) return stored
  const id = randomId(16)
  write(DEVICE_KEY, id)
  return id
}

type Stored = Record<PersonId, { answer: Answer; at: number }>

function readLink(shareId: string): Stored {
  let value: unknown
  try {
    value = JSON.parse(read(PREFIX + shareId) ?? '{}')
  } catch {
    return {}
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const entries: Stored = {}
  for (const [personId, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!isId(personId) || typeof entry !== 'object' || entry === null) continue
    const { answer, at } = entry as Record<string, unknown>
    if (ANSWERS.has(answer) && typeof at === 'number' && Number.isFinite(at)) entries[personId] = { answer: answer as Answer, at }
  }
  return entries
}

/** Records the latest answer this phone sent for a person on a link. */
export function rememberAnswer(shareId: string, personId: PersonId, answer: Answer, at: number): void {
  write(PREFIX + shareId, JSON.stringify({ ...readLink(shareId), [personId]: { answer, at } }))
}

/** The names this phone answered for on a link, most recent answer first. */
export function answeredFor(shareId: string): Answered[] {
  return Object.entries(readLink(shareId))
    .map(([personId, { answer, at }]) => ({ personId, answer, at }))
    .sort((a, b) => b.at - a.at)
}

export function forgetNames(shareId: string): void {
  remove(PREFIX + shareId)
}
