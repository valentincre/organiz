import { addDays, parseIso } from '../domain/dates'
import { closesAtFor } from '../domain/shares'
import type { AppEvent, DashboardState, EventId, IsoDate, PersonId, PropertyDef, PropertyValues, ReplyTrace, ShareEntry, ShareId } from '../domain/types'

const NAMES = [
  'Jean Dupont', 'Marie Martin', 'Lucas Bernard', 'Emma Petit', 'Hugo Durand', 'Chloé Leroy',
  'Louis Moreau', 'Léa Simon', 'Arthur Laurent', 'Manon Lefèvre', 'Jules Michel', 'Inès Garcia',
  'Paul Roux', 'Sarah Fournier', 'Nathan Girard', 'Julie Bonnet', 'Gabriel Dupuis', 'Camille Lambert',
  'Raphaël Fontaine', 'Zoé Rousseau', 'Adam Vincent', 'Lina Muller', 'Noah Faure', 'Jade André',
  'Ethan Mercier', 'Rose Blanc', 'Tom Guérin', 'Alice Boyer', 'Mathis Garnier', 'Anaïs Chevalier',
]

/** Coaches and volunteers: everyone else is a player. */
const STAFF = new Set([4, 11, 19, 23])

const OPPONENTS = ['AS Saint-Rémy', 'FC Les Pins', 'US Valmont', 'Olympique Rivière', 'ES Beaulieu', 'Stade Clairval']

/** School-holiday-like breaks (month-day ranges) with no events, to make the calendar look real. */
const BREAKS: [string, string][] = [
  ['12-20', '12-31'],
  ['01-01', '01-04'],
  ['02-14', '03-01'],
  ['04-11', '04-26'],
  ['07-11', '08-23'],
]

const TEXT = {
  en: {
    player: 'Player', yes: 'Yes', no: 'No', position: 'Position', goalkeeper: 'Goalkeeper', defender: 'Defender',
    midfielder: 'Midfielder', forward: 'Forward', category: 'Category', license: 'License', born: 'Born on', note: 'Note',
    type: 'Type', training: 'Training', match: 'Match', meal: 'Team meal', opponent: 'Opponent', score: 'Score', notes: 'Notes',
    allergy: 'Peanut allergy', asthma: 'Asthma: inhaler in the bag', driver: 'Can drive to away matches',
    mealNotes: 'Bring a dish to share.\nDrinks are on the club.', rain: 'Moved to the indoor pitch because of the rain.',
  },
  fr: {
    player: 'Joueur', yes: 'Oui', no: 'Non', position: 'Poste', goalkeeper: 'Gardien', defender: 'Défenseur',
    midfielder: 'Milieu', forward: 'Attaquant', category: 'Catégorie', license: 'Licence', born: 'Né le', note: 'Remarque',
    type: 'Type', training: 'Entraînement', match: 'Match', meal: 'Repas d’équipe', opponent: 'Adversaire', score: 'Score', notes: 'Notes',
    allergy: 'Allergie aux arachides', asthma: 'Asthme : ventoline dans le sac', driver: 'Peut conduire aux matchs à l’extérieur',
    mealNotes: 'Chacun apporte un plat à partager.\nLes boissons sont offertes par le club.', rain: 'Déplacé au gymnase à cause de la pluie.',
  },
}

/** Small deterministic PRNG (mulberry32) so every visitor sees the same demo. */
function createRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Milliseconds since epoch of a date and "HH:MM" in the viewer's time zone. */
function localTime(date: IsoDate, time: string): number {
  const [year, month, day] = date.split('-').map(Number)
  const [hours, minutes] = time.split(':').map(Number)
  return new Date(year, month - 1, day, hours, minutes).getTime()
}

const isBreak = (date: IsoDate) => BREAKS.some(([from, to]) => date.slice(5) >= from && date.slice(5) <= to)

type Kind = 'training' | 'match' | 'meal'

/**
 * A season of a youth football club ending on `today`: weekly trainings (one
 * series), a match every other Saturday, a few team meals after a training,
 * breaks, people with different attendance habits who join or leave during
 * the season, and custom properties for people and events. Past events have
 * replies and a roll call (most people who said yes came, a few came without
 * telling, a few who said yes did not), except the last three, which show
 * "no roll call". The next training only has replies. With `share`, those replies came through
 * an open public reply link of that id and key, one phone each. The Statistics tab starts with
 * two composed charts: attendance rate by position and events by type.
 */
export function buildDemoState(name: string, today: IsoDate, lang: 'en' | 'fr' = 'en', share?: { id: ShareId; key: string }): DashboardState {
  const text = TEXT[lang]
  const random = createRandom(42)
  const start = addDays(today, -340)

  const personProperties: Record<string, PropertyDef> = {
    player: { kind: 'choice', name: text.player, order: 0, options: { yes: { label: text.yes, order: 0, color: 'green' }, no: { label: text.no, order: 1, color: 'gray' } } },
    position: {
      kind: 'multi',
      name: text.position,
      order: 1,
      options: {
        gk: { label: text.goalkeeper, order: 0, color: 'amber' },
        def: { label: text.defender, order: 1, color: 'blue' },
        mid: { label: text.midfielder, order: 2, color: 'teal' },
        fwd: { label: text.forward, order: 3, color: 'red' },
      },
    },
    category: { kind: 'choice', name: text.category, order: 2, options: { u13: { label: 'U13', order: 0, color: 'purple' }, u15: { label: 'U15', order: 1, color: 'pink' } } },
    license: { kind: 'number', name: text.license, order: 3 },
    born: { kind: 'date', name: text.born, order: 4 },
    note: { kind: 'text', name: text.note, order: 5 },
  }
  const eventProperties: Record<string, PropertyDef> = {
    type: {
      kind: 'choice',
      name: text.type,
      order: 0,
      options: {
        training: { label: text.training, order: 0, color: 'blue' },
        match: { label: text.match, order: 1, color: 'amber' },
        meal: { label: text.meal, order: 2, color: 'purple' },
      },
    },
    opponent: { kind: 'text', name: text.opponent, order: 1 },
    score: { kind: 'text', name: text.score, order: 2 },
    notes: { kind: 'text', name: text.notes, order: 3 },
  }

  const positions = ['gk', 'def', 'mid', 'fwd']
  const notes: Record<number, string> = { 2: text.allergy, 13: text.asthma, 19: text.driver }
  const people = NAMES.map((personName, index) => {
    const profile = random()
    const rate =
      profile < 0.3 ? 0.85 + random() * 0.13 : profile < 0.75 ? 0.5 + random() * 0.3 : 0.12 + random() * 0.3
    const joins = index >= 26 ? addDays(start, 120 + Math.floor(random() * 150)) : undefined
    const leaves = index === 5 || index === 17 ? addDays(start, 90 + Math.floor(random() * 90)) : undefined
    const values: PropertyValues = { player: STAFF.has(index) ? 'no' : 'yes' }
    if (!STAFF.has(index)) {
      const main = positions[index % 4 === 0 ? 0 : 1 + Math.floor(random() * 3)]
      const second = random() < 0.25 ? positions[1 + Math.floor(random() * 3)] : main
      values.position = [...new Set([main, second])].sort()
      const older = random() < 0.5
      values.category = older ? 'u15' : 'u13'
      values.license = 2400000 + Math.floor(random() * 90000)
      values.born = addDays(older ? '2011-09-01' : '2013-09-01', Math.floor(random() * 360))
    }
    if (notes[index]) values.note = notes[index]
    // Founding members were added a few months before the first event, before the Statistics tab's default
    // period (the last 12 months) whatever today is; the others on the day they joined, so they count as newcomers.
    const createdAt = joins ? localTime(joins, '09:00') : localTime(addDays(start, -90 + 2 * index), '20:00')
    return { id: `demo${index}` as PersonId, name: personName, rate, joins, leaves, values, createdAt }
  })

  const planned: { id: EventId; date: IsoDate; kind: Kind; event: Omit<AppEvent, 'date' | 'createdAt'> }[] = []
  let trainings = 0
  let matches = 0
  for (let offset = 0, date = start; date <= today; offset++, date = addDays(start, offset)) {
    if (isBreak(date)) continue
    const weekday = parseIso(date).getUTCDay()
    if (weekday === 3) {
      trainings++
      const values: PropertyValues = { type: 'training' }
      if (trainings === 14) values.notes = text.rain
      planned.push({ id: `t${trainings}`, date, kind: 'training', event: { name: text.training, start: '18:00', end: '19:30', seriesId: 'trainings', values } })
      // A few team meals right after a training: two events on the same day.
      if (trainings % 13 === 6) {
        planned.push({ id: `meal${trainings}`, date, kind: 'meal', event: { name: text.meal, start: '19:45', end: '21:30', values: { type: 'meal', notes: text.mealNotes } } })
      }
    }
    if (weekday === 6 && Math.floor(offset / 7) % 2 === 0) {
      matches++
      const opponent = OPPONENTS[matches % OPPONENTS.length]
      const values: PropertyValues = { type: 'match', opponent, score: `${Math.floor(random() * 5)}-${Math.floor(random() * 4)}` }
      planned.push({ id: `m${matches}`, date, kind: 'match', event: { name: `${text.match} · ${opponent}`, start: '15:00', end: '16:30', values } })
    }
  }

  /** `{ [key]: sorted ids }`, or nothing for an empty list (the data omits empty lists). */
  const list = <K extends string>(key: K, ids: PersonId[]) => (ids.length > 0 ? ({ [key]: [...ids].sort() } as Record<K, PersonId[]>) : {})
  const activeOn = (date: IsoDate) => people.filter((p) => (!p.joins || date >= p.joins) && (!p.leaves || date <= p.leaves))
  // The most recent events have not been called yet.
  const uncalled = new Set(planned.slice(-3).map((p) => p.id))

  const events: Record<EventId, AppEvent> = {}
  for (const [index, { id, date, kind, event }] of planned.entries()) {
    const boost = kind === 'match' ? 0.08 : kind === 'meal' ? 0.15 : -0.05
    const month = Number(date.slice(5, 7))
    const winter = month === 12 || month <= 2 ? -0.1 : 0
    const active = activeOn(date)
    const came = new Set(active.filter((p) => random() < Math.min(0.98, Math.max(0.02, p.rate + boost + winter))).map((p) => p.id))
    const yes: PersonId[] = []
    const no: PersonId[] = []
    for (const { id: personId } of active) {
      const roll = random()
      if (came.has(personId)) {
        // Most people who came had said yes; a few said nothing, hardly anybody said no.
        if (roll < 0.78) yes.push(personId)
        else if (roll < 0.82) no.push(personId)
      } else if (roll < 0.2) yes.push(personId)
      else if (roll < 0.55) no.push(personId)
    }
    const call = uncalled.has(id)
      ? {}
      : {
          // The call is made a few minutes after the start, in the viewer's time zone like the event.
          calledAt: localTime(date, event.start ?? '00:00') + 5 * 60_000,
          ...list('present', [...came]),
          ...list('absent', active.map((p) => p.id).filter((personId) => !came.has(personId))),
        }
    events[id] = { date, ...event, createdAt: index, ...list('yes', yes), ...list('no', no), ...call }
  }
  // The next training: the first Wednesday after today, with some replies.
  const nextWednesday = addDays(today, ((3 - parseIso(today).getUTCDay() + 7) % 7) || 7)
  const upcoming = activeOn(nextWednesday).map((p, index) => ({ id: p.id, roll: random(), index }))
  events.next = {
    date: nextWednesday,
    name: text.training,
    start: '18:00',
    end: '19:30',
    seriesId: 'trainings',
    values: { type: 'training' },
    createdAt: planned.length,
    ...list('yes', upcoming.filter((p) => p.roll < 0.4).map((p) => p.id)),
    // A few "no", whatever the draw, so the upcoming training always shows some.
    ...list('no', upcoming.filter((p) => p.roll >= 0.4 && (p.roll < 0.5 || p.index % 9 === 4)).map((p) => p.id)),
  }

  let shares: Record<ShareId, ShareEntry> | undefined
  if (share) {
    // Opened two days ago; the answers came in since, in a random order, all folded and seen before today.
    const createdAt = localTime(addDays(today, -2), '18:00')
    const span = localTime(today, '00:00') - createdAt
    const answered = [...(events.next.yes ?? []), ...(events.next.no ?? [])]
      .map((id) => ({ id, roll: random() }))
      .sort((a, b) => a.roll - b.roll)
    const replyLog: Record<PersonId, ReplyTrace> = {}
    for (const [index, { id }] of answered.entries()) {
      replyLog[id] = { via: 'shared', at: createdAt + Math.round((span * (index + 1)) / (answered.length + 1)), device: `demo-${index + 1}` }
    }
    const mergedUpTo = Math.max(createdAt, ...Object.values(replyLog).map((trace) => trace.at ?? 0))
    events.next = { ...events.next, replyLog, repliesSeenAt: mergedUpTo }
    shares = {
      [share.id]: {
        eventId: 'next',
        kind: 'presence',
        key: share.key,
        visibility: 'public',
        autoClose: true,
        closesAt: closesAtFor('presence', events.next),
        closed: false,
        createdAt,
        mergedUpTo,
        replied: true,
      },
    }
  }

  return {
    v: 3,
    name,
    people: Object.fromEntries(
      // Leaving people stop being expected after their last day (`leftOn` is inclusive, like `leaves`).
      people.map((p) => [p.id, { name: p.name, createdAt: p.createdAt, values: p.values, ...(p.leaves && { leftOn: p.leaves }) }]),
    ),
    events,
    personProperties,
    eventProperties,
    statCharts: {
      // Players only: the staff have no position.
      byPosition: { show: 'rate', split: { person: 'position' }, people: 'player:yes', order: 0 },
      byType: { show: 'events', split: { event: 'type' }, order: 1 },
    },
    ...(shares && { shares }),
  }
}
