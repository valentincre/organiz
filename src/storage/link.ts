import type { PersonId } from '../domain/types'
import { isId } from '../domain/validate'

/** What a link grants: the edit link can write, the read link only decrypts. */
export type Access = 'edit' | 'read'

/**
 * What a share link carries: which document, and its key. For edit access the
 * key is the secret `S` of the edit link; for read access it is the encryption key.
 */
export interface DashboardRef {
  docId: string
  key: string
  access: Access
}

const DOC_ID = /^[A-Za-z0-9_-]{22}$/
const KEY = /^[A-Za-z0-9_-]{43}$/

export function isValidRef({ docId, key }: DashboardRef): boolean {
  return DOC_ID.test(docId) && KEY.test(key)
}

/** Shape check of a reply link's share id and key (same formats as a dashboard ref). */
export function isValidReplyRef(shareId: string, key: string): boolean {
  return DOC_ID.test(shareId) && KEY.test(key)
}

/** What a personal link carries: the hub document and its key, the person, and their secret. */
export interface PersonalRef {
  hubId: string
  hubKey: string
  personId: PersonId
  secret: string
}

/** Shape check of a personal link: hub id like a document id, hub key and secret like keys, a valid person id. */
export function isValidPersonalRef({ hubId, hubKey, personId, secret }: PersonalRef): boolean {
  return DOC_ID.test(hubId) && KEY.test(hubKey) && isId(personId) && KEY.test(secret)
}

/**
 * The public demo: generated in the browser, never stored. Its id cannot
 * clash with a real one (those are 22 characters).
 */
export const DEMO_REF: DashboardRef = { docId: 'demo', key: '', access: 'edit' }

export const isDemoRef = ({ docId }: Pick<DashboardRef, 'docId'>): boolean => docId === DEMO_REF.docId

export function dashboardPath(ref: DashboardRef): string {
  if (isDemoRef(ref)) return '/demo'
  return `/${ref.access === 'edit' ? 'd' : 'v'}/${ref.docId}/${ref.key}`
}

/** The read-only ref of an edit ref, given the encryption key derived from its secret. */
export function readRefOf(ref: DashboardRef, encKeyString: string): DashboardRef {
  return { docId: ref.docId, key: encKeyString, access: 'read' }
}

/**
 * Absolute link to the dashboard root; the key stays in the fragment, never
 * sent to a server. Always on "/", whichever home page the dashboard was opened from.
 */
export function buildShareLink(ref: DashboardRef, origin: string): string {
  return `${origin}/#${dashboardPath(ref)}`
}

/** Path of a reply link: the share id, and the key that decrypts it. */
export function replyPath(shareId: string, key: string): string {
  return `/r/${shareId}/${key}`
}

/** Path of a reply link of the demo, which works in its tab only. */
export function demoReplyPath(shareId: string, key: string): string {
  return `${dashboardPath(DEMO_REF)}${replyPath(shareId, key)}`
}

/** Absolute reply link; like the dashboard link, the key stays in the fragment. */
export function buildReplyLink(shareId: string, key: string, origin: string): string {
  return `${origin}/#${replyPath(shareId, key)}`
}

/** Path of a personal link. */
export function personalPath({ hubId, hubKey, personId, secret }: PersonalRef): string {
  return `/p/${hubId}/${hubKey}/${personId}/${secret}`
}

/** Absolute personal link; its keys and secret stay in the fragment, never sent to a server. */
export function buildPersonalLink(ref: PersonalRef, origin: string): string {
  return `${origin}/#${personalPath(ref)}`
}
