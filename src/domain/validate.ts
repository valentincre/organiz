import { isValidIso, isValidTimeRange } from './dates'
import { LIMITS } from './limits'
import { COLOR_KEYS, type DashboardState } from './types'

/** Schema version this build reads and writes. */
export const STATE_VERSION = 3

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const ID = /^[A-Za-z0-9_-]{1,22}$/

/** Base64url id that cannot shadow an Object.prototype member such as "constructor". */
export const isId = (value: unknown): value is string => typeof value === 'string' && ID.test(value) && !(value in Object.prototype)

const isName = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max

/** Disjointness of each pair is kept by the mutations, not checked here: readers give `present` and `yes` precedence. */
const REPLY_AND_PRESENCE_LISTS = ['yes', 'no', 'present', 'absent']

const SHARE_KEY = /^[A-Za-z0-9_-]{43}$/
const SHARE_KINDS = new Set(['presence', 'call'])
const VISIBILITIES = new Set(['public', 'private'])
const VIAS = new Set(['shared', 'personal', 'hand'])

const isShare = (share: Record<string, unknown>) =>
  isId(share.eventId) &&
  SHARE_KINDS.has(share.kind as string) &&
  typeof share.key === 'string' &&
  SHARE_KEY.test(share.key) &&
  VISIBILITIES.has(share.visibility as string) &&
  typeof share.autoClose === 'boolean' &&
  (share.closesAt === null || Number.isFinite(share.closesAt)) &&
  typeof share.closed === 'boolean' &&
  Number.isFinite(share.createdAt) &&
  Number.isFinite(share.mergedUpTo) &&
  (share.replied === undefined || share.replied === true) &&
  (share.finished === undefined || share.finished === true)

const HUB_ID = /^[A-Za-z0-9_-]{22}$/

const isHub = (hub: unknown) => isObject(hub) && typeof hub.id === 'string' && HUB_ID.test(hub.id) && typeof hub.key === 'string' && SHARE_KEY.test(hub.key)

const isPersonalLink = (link: Record<string, unknown>) => typeof link.secret === 'string' && SHARE_KEY.test(link.secret) && Number.isFinite(link.createdAt)

const isTrace = (trace: Record<string, unknown>) =>
  VIAS.has(trace.via as string) &&
  (trace.at === undefined || Number.isFinite(trace.at)) &&
  (trace.device === undefined || isId(trace.device)) &&
  (trace.sentAt === undefined || Number.isFinite(trace.sentAt)) &&
  (trace.others === undefined ||
    (Array.isArray(trace.others) &&
      trace.others.length <= LIMITS.traceOthers &&
      trace.others.every(
        (other) =>
          isObject(other) && (other.answer === 'yes' || other.answer === 'no' || other.answer === 'none') && Number.isFinite(other.at) && isId(other.device),
      )))

const isJwkString = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= LIMITS.jwk

const KINDS = new Set(['choice', 'multi', 'text', 'number', 'date'])
const COLORS = new Set<unknown>(COLOR_KEYS)
const KEY_LIMITS = { personProperties: LIMITS.personProperties, eventProperties: LIMITS.eventProperties }

/** Data written by a newer build: this one must neither show nor overwrite it. */
export const isNewerVersion = (value: unknown): boolean =>
  isObject(value) && typeof value.v === 'number' && value.v > STATE_VERSION

/** Every key is an id and every entry passes `check`, within `max` entries. */
const isRecord = (value: unknown, max: number, check: (entry: Record<string, unknown>) => boolean): boolean =>
  isObject(value) &&
  Object.keys(value).length <= max &&
  Object.entries(value).every(([id, entry]) => isId(id) && isObject(entry) && check(entry))

const isProperty = (def: Record<string, unknown>) =>
  KINDS.has(def.kind as string) &&
  isName(def.name, LIMITS.label) &&
  Number.isFinite(def.order) &&
  (def.options === undefined ||
    isRecord(
      def.options,
      LIMITS.options,
      (option) => isName(option.label, LIMITS.label) && Number.isFinite(option.order) && COLORS.has(option.color),
    ))

/**
 * Values are checked for their shape only: one that no longer matches its
 * property (deleted concurrently) is ignored when read, never fatal.
 */
const isValues = (values: unknown) =>
  values === undefined ||
  (isObject(values) &&
    Object.entries(values).every(
      ([id, value]) =>
        isId(id) &&
        ((typeof value === 'string' && value.length <= LIMITS.textValue) ||
          Number.isFinite(value) ||
          (Array.isArray(value) && value.length <= LIMITS.options && value.every(isId))),
    ))

/** An optional list of person ids, at most one per person. */
const isIdList = (value: unknown, max: number) => value === undefined || (Array.isArray(value) && value.length <= max && value.every(isId))

const SHOWS = new Set(['rate', 'present', 'absent', 'replyRate', 'events', 'newcomers'])
const SPLITS = new Set(['none', 'month', 'week'])

const isSplit = (split: unknown) =>
  SPLITS.has(split as string) || (isObject(split) && (isId(split.person) !== isId(split.event)))

const isFilterString = (value: unknown) => value === undefined || (typeof value === 'string' && value.length <= LIMITS.encodedFilter)

const isStatChart = (chart: Record<string, unknown>) =>
  SHOWS.has(chart.show as string) &&
  isSplit(chart.split) &&
  (chart.name === undefined || isName(chart.name, LIMITS.chartName)) &&
  isFilterString(chart.people) &&
  isFilterString(chart.events) &&
  Number.isFinite(chart.order)

/**
 * Checks the shape and size of decrypted data before the app trusts it, so a
 * malformed or oversized dashboard cannot break or freeze the interface.
 */
export function isDashboardState(value: unknown): value is DashboardState {
  if (!isObject(value) || value.v !== STATE_VERSION || !isName(value.name, LIMITS.dashboardName)) return false
  for (const [key, max] of Object.entries(KEY_LIMITS)) {
    if (!isRecord(value[key], max, isProperty)) return false
  }
  const peopleOk = isRecord(
    value.people,
    LIMITS.people,
    (person) =>
      isName(person.name, LIMITS.personName) &&
      Number.isFinite(person.createdAt) &&
      isValues(person.values) &&
      (person.leftOn === undefined || (typeof person.leftOn === 'string' && isValidIso(person.leftOn))),
  )
  if (!peopleOk) return false
  const personCount = Object.keys(value.people as object).length
  if (value.shares !== undefined && !isRecord(value.shares, LIMITS.shares, isShare)) return false
  if (value.hub !== undefined && !isHub(value.hub)) return false
  if (value.personalLinks !== undefined) {
    const links = value.personalLinks
    if (!isRecord(links, personCount, isPersonalLink)) return false
    if (!Object.keys(links as object).every((id) => Object.hasOwn(value.people as object, id))) return false
  }
  if (value.statCharts !== undefined && !isRecord(value.statCharts, LIMITS.statCharts, isStatChart)) return false
  if (value.organizerKeys !== undefined) {
    const keys = value.organizerKeys
    if (!isObject(keys) || !isJwkString(keys.publicKey) || !isJwkString(keys.privateKey)) return false
  }
  return isRecord(
    value.events,
    LIMITS.events,
    (event) =>
      typeof event.date === 'string' &&
      isValidIso(event.date) &&
      typeof event.name === 'string' &&
      event.name.length <= LIMITS.eventName &&
      isValidTimeRange(event.start as string | undefined, event.end as string | undefined) &&
      (event.seriesId === undefined || isId(event.seriesId)) &&
      Number.isFinite(event.createdAt) &&
      REPLY_AND_PRESENCE_LISTS.every((key) => isIdList(event[key], personCount)) &&
      (event.calledAt === undefined || Number.isFinite(event.calledAt)) &&
      (event.replyLog === undefined || isRecord(event.replyLog, personCount, isTrace)) &&
      (event.repliesSeenAt === undefined || Number.isFinite(event.repliesSeenAt)) &&
      isValues(event.values),
  )
}
