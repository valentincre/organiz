export type PersonId = string
export type EventId = string
export type PropertyId = string
export type OptionId = string
/** Shared by the events created together by a weekly repetition. */
export type SeriesId = string

/** Calendar date formatted as "YYYY-MM-DD". */
export type IsoDate = string

/** Time of day formatted as "HH:MM" (24 h). */
export type Time = string

/** Custom properties exist for people and for events, with the same kinds and rules. */
export type PropertyScope = 'person' | 'event'

export type PropertyKind = 'choice' | 'multi' | 'text' | 'number' | 'date'

/** Palette entries for options; each has a light and a dark variant in styles.css. */
export const COLOR_KEYS = ['blue', 'green', 'amber', 'red', 'purple', 'teal', 'pink', 'gray'] as const
export type ColorKey = (typeof COLOR_KEYS)[number]

export interface PropertyOption {
  label: string
  order: number
  color: ColorKey
}

export interface PropertyDef {
  /** Fixed at creation, except choice → multi. */
  kind: PropertyKind
  name: string
  order: number
  /** Only for choice and multi. */
  options?: Record<OptionId, PropertyOption>
}

/**
 * A value is read according to its property's kind: an option id (choice), a
 * sorted list of option ids (multi), a string (text), a number, or an IsoDate.
 */
export type PropertyValue = string | number | OptionId[]
export type PropertyValues = Record<PropertyId, PropertyValue>

export interface Person {
  name: string
  createdAt: number
  values?: PropertyValues
  /** Left the group on this day (inclusive); history is kept. */
  leftOn?: IsoDate
}

/** What a person said before an event. */
export type Reply = 'yes' | 'no'

export interface AppEvent {
  date: IsoDate
  /** Both absent: the event lasts all day. */
  start?: Time
  /** Only with a start; later than the start, same day. */
  end?: Time
  /** Empty: shown as "Event on {date}". */
  name: string
  seriesId?: SeriesId
  values?: PropertyValues
  createdAt: number
  /** Replies given before the event, sorted; a person is in at most one list. Omitted when empty. */
  yes?: PersonId[]
  no?: PersonId[]
  /** When the last roll call was finished (ms since epoch); real presence exists only once set. */
  calledAt?: number
  /** Real presence from roll calls, sorted, disjoint; people never called are in neither. Omitted when empty. */
  present?: PersonId[]
  absent?: PersonId[]
  /** Where each person's current reply came from; kept only for events that have or had a reply link. */
  replyLog?: Record<PersonId, ReplyTrace>
  /** `createdAt` (ms) of the newest reply the organizer has seen; replies newer than this are unread. */
  repliesSeenAt?: number
}

export type ShareId = string
/** 'call' is created by plan B; plan A only creates presence links. */
export type ShareKind = 'presence' | 'call'
export type Visibility = 'public' | 'private'

/** A reply link as organizers know it. The share document holds what respondents see. */
export interface ShareEntry {
  eventId: EventId
  kind: ShareKind
  /** 32 random bytes in base64url; travels in the link, encrypts the share and its public replies. */
  key: string
  visibility: Visibility
  autoClose: boolean
  /** ms since epoch; null = open until closed by hand. */
  closesAt: number | null
  /** Closed by hand or because the event was deleted; never reopened. */
  closed: boolean
  createdAt: number
  /** `createdAt` (ms) of the newest folded reply; 0 before the first. */
  mergedUpTo: number
  /** A reply was folded: a private link can no longer become public. */
  replied?: true
  /** Call links: "Finish" was pressed; its check-ins up to mergedUpTo are in the call, later ones fold into presence. */
  finished?: true
}

/** A person's own reply link, as organizers know it. */
export interface PersonalLink {
  /** 32 random bytes in base64url; travels in the person's link, signs their replies and seals their hub entry. */
  secret: string
  createdAt: number
}

export type ReplyVia = 'shared' | 'personal' | 'hand'
/** 'none' = the respondent cleared their reply. */
export type Answer = Reply | 'none'

/** Where a person's current reply to an event came from; kept only for events that have or had a link. */
export interface ReplyTrace {
  via: ReplyVia
  /**
   * Server time of the reply, or device time of the hand edit (ms). Absent, like everything but
   * `via`, once the event is over and has no link left (see `trimTraces`).
   */
  at?: number
  /** Device of a reply; absent for hand edits. */
  device?: string
  /** Disagreeing replies from other devices since the last "Keep", newest first, at most LIMITS.traceOthers. */
  others?: { answer: Answer; at: number; device: string }[]
  /**
   * Device time the last accepted personal reply was signed with, kept across later hand edits:
   * a personal reply not sent after it is a replay and is ignored.
   */
  sentAt?: number
}

export interface DashboardState {
  v: 3
  name: string
  people: Record<PersonId, Person>
  events: Record<EventId, AppEvent>
  personProperties: Record<PropertyId, PropertyDef>
  eventProperties: Record<PropertyId, PropertyDef>
  shares?: Record<ShareId, ShareEntry>
  /** ECDH P-256 keys as JWK JSON strings. */
  organizerKeys?: { publicKey: string; privateKey: string }
  /** The dashboard's hub document, once a personal link exists. */
  hub?: { id: string; key: string }
  personalLinks?: Record<PersonId, PersonalLink>
  statCharts?: Record<ChartId, StatChart>
}

export type ChartId = string
export type ChartShow = 'rate' | 'present' | 'absent' | 'replyRate' | 'events' | 'newcomers'
export type ChartSplit = 'none' | 'month' | 'week' | { person: PropertyId } | { event: PropertyId }

/** A composed chart of the Statistics tab. */
export interface StatChart {
  /** Absent: the default name built from show and split. */
  name?: string
  show: ChartShow
  split: ChartSplit
  /** Filters in the URL encoding of domain/filters (encodeFilter); decoded against the current properties. */
  people?: string
  events?: string
  order: number
}

/** Pure state transition; returns the same object when nothing changes. */
export type Mutation = (state: DashboardState) => DashboardState
