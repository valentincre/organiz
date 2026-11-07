/**
 * Upper bounds shared by the UI and the validation of decrypted data. The
 * server only sees ciphertext, so these are enforced by the app itself.
 */
export const LIMITS = {
  dashboardName: 80,
  personName: 100,
  eventName: 100,
  people: 2000,
  events: 5000,
  personProperties: 30,
  eventProperties: 20,
  options: 50,
  /** Property names and option labels. */
  label: 50,
  textValue: 2000,
  /** Events created by one weekly repetition. */
  series: 200,
  /** Reply links per dashboard. */
  shares: 500,
  /** Disagreeing replies kept in a reply trace. */
  traceOthers: 5,
  /** Composed charts per dashboard. */
  statCharts: 30,
  chartName: 80,
  /** A filter in its URL encoding. */
  encodedFilter: 2000,
  /** A JWK serialized as JSON. */
  jwk: 600,
} as const

/** Trims a name and cuts it to the given length. */
export const clampName = (name: string, max: number): string => name.trim().slice(0, max).trim()

/** Own-key lookup, so ids such as "constructor" never resolve to Object.prototype members. */
export const hasKey = (record: object, key: string): boolean => Object.hasOwn(record, key)
