import { sortedProperties } from '../domain/properties'
import type { PersonEntry } from '../domain/selectors'
import type { DashboardState, IsoDate } from '../domain/types'
import { useI18n } from '../i18n/context'
import { viewPath } from '../router'
import type { DashboardRef } from '../storage/link'
import { ChevronIcon } from './components/icons'
import { cx } from './components/styles'
import { ValueView } from './properties/ValueView'

interface Props {
  dashboardRef: DashboardRef
  state: DashboardState
  person: PersonEntry
  /** Events attended, and the latest one's date. */
  attended: number
  last?: IsoDate
  /** The day they left, when they have left the group. */
  leftOn?: IsoDate
  /** Selection mode: the row ticks a checkbox instead of opening the person's page. */
  selection?: { selected: boolean; onChange: (selected: boolean) => void }
}

/** A person in the people list: name, choice values and attendance; opens their page. */
export function PersonRow({ dashboardRef, state, person, attended, last, leftOn, selection }: Props) {
  const { t, formatDate } = useI18n()
  const chips = sortedProperties(state, 'person')
    .filter((p) => p.kind === 'choice' || p.kind === 'multi')
    .slice(0, 3)
  const rowClass = 'flex min-h-touch w-full cursor-pointer items-center gap-3 px-4 py-2 text-left text-text no-underline hover:bg-surface-muted'

  const content = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block font-medium [overflow-wrap:anywhere]">{person.name}</span>
        {leftOn && <span className="block text-xs text-muted">{t('person.leftOn', { date: formatDate(leftOn, { dateStyle: 'medium' }) })}</span>}
        {chips.some((p) => person.values?.[p.id] !== undefined) && (
          <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1">
            {chips.map((p) => (
              <ValueView key={p.id} defs={state.personProperties} propertyId={p.id} values={person.values} compact withName />
            ))}
          </span>
        )}
      </span>
      <span className="shrink-0 text-right text-sm text-muted">
        <span className="font-medium text-text">{t('people.attended', { count: attended })}</span>
        {last && <span className="hidden sm:inline"> · {t('people.last', { date: formatDate(last, { dateStyle: 'medium' }) })}</span>}
      </span>
    </>
  )

  return (
    <li>
      {selection ? (
        <label className={cx(rowClass, selection.selected && 'bg-accent-soft hover:bg-accent-soft')}>
          <input
            type="checkbox"
            className="size-5 shrink-0 accent-accent"
            checked={selection.selected}
            onChange={(e) => selection.onChange(e.target.checked)}
          />
          {content}
        </label>
      ) : (
        <a href={`#${viewPath(dashboardRef, { tab: 'person', personId: person.id })}`} className={rowClass}>
          {content}
          <span className="text-muted">
            <ChevronIcon direction="right" small />
          </span>
        </a>
      )}
    </li>
  )
}
