import type { DashboardState, PersonId } from './types'

/** Lowercase, accent-free text with punctuation turned into spaces. */
export function foldText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Lowercase, accent-free words joined by single dashes, for file names. */
export const slugify = (text: string): string => foldText(text).replace(/ /g, '-')

/**
 * Comparison key for names: ignores case, accents, punctuation, extra spaces
 * and word order, so "DUPONT  jean" and "Jean Dupont" share the same key.
 */
export function normalizeName(name: string): string {
  return foldText(name).split(' ').filter(Boolean).sort().join(' ')
}

/** Search-as-you-type: every word of the query appears somewhere in the name. */
export function matchesSearch(name: string, query: string): boolean {
  const folded = foldText(name)
  return foldText(query)
    .split(' ')
    .filter(Boolean)
    .every((word) => folded.includes(word))
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
    }
    previous = current
  }
  return previous[b.length]
}

export function findPersonByName(state: DashboardState, name: string): PersonId | undefined {
  const key = normalizeName(name)
  if (!key) return undefined
  return Object.entries(state.people).find(([, person]) => normalizeName(person.name) === key)?.[0]
}

export type MatchResult =
  | { kind: 'matched'; input: string; personId: PersonId }
  | { kind: 'suggested'; input: string; personId: PersonId; distance: number }
  | { kind: 'unknown'; input: string }

export interface MatchReport {
  results: MatchResult[]
  /** Inputs dropped because an earlier row had the same normalized name. */
  duplicates: string[]
}

/** Typo tolerance: about one edit per five characters, at least one. */
const maxDistance = (key: string) => Math.max(1, Math.floor(key.length * 0.2))

export function matchNames(inputs: string[], state: DashboardState): MatchReport {
  const people = Object.entries(state.people).map(([id, person]) => ({ id, key: normalizeName(person.name) }))
  const byKey = new Map<string, PersonId>()
  for (const { id, key } of people) if (!byKey.has(key)) byKey.set(key, id)

  const seen = new Set<string>()
  const results: MatchResult[] = []
  const duplicates: string[] = []

  for (const raw of inputs) {
    const input = raw.trim().replace(/\s+/g, ' ')
    const key = normalizeName(input)
    if (!key) continue
    if (seen.has(key)) {
      duplicates.push(input)
      continue
    }
    seen.add(key)

    const exact = byKey.get(key)
    if (exact) {
      results.push({ kind: 'matched', input, personId: exact })
      continue
    }

    let best: { id: PersonId; distance: number } | undefined
    for (const person of people) {
      const distance = levenshtein(key, person.key)
      if (!best || distance < best.distance) best = { id: person.id, distance }
    }
    results.push(
      best && best.distance <= maxDistance(key)
        ? { kind: 'suggested', input, personId: best.id, distance: best.distance }
        : { kind: 'unknown', input },
    )
  }
  return { results, duplicates }
}
