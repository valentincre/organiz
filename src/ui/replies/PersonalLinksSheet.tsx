import { useState } from 'react'
import { matchesSearch } from '../../domain/matching'
import { sortedPeople } from '../../domain/selectors'
import type { DashboardState, Mutation } from '../../domain/types'
import { useI18n } from '../../i18n/context'
import { Dialog } from '../components/Dialog'
import { SearchInput } from '../components/SearchInput'
import { PersonalLinkRow } from './PersonalLinkRow'

/** From this many people, the list gets a search field. */
const SEARCH_FROM = 10

interface Props {
  open: boolean
  onClose: () => void
  state: DashboardState
  mutate: (mutation: Mutation) => void
}

/** Everyone's personal link, to create, copy, show as a QR code or revoke: a modal, a sheet from the bottom on phones. */
export function PersonalLinksSheet({ open, onClose, state, mutate }: Props) {
  const { t } = useI18n()
  return (
    <Dialog open={open} onClose={onClose} title={t('personal.links')} closeLabel={t('replies.dismiss')} sheet>
      <PersonalLinksList state={state} mutate={mutate} />
    </Dialog>
  )
}

function PersonalLinksList({ state, mutate }: Omit<Props, 'open' | 'onClose'>) {
  const { t, lang } = useI18n()
  const [query, setQuery] = useState('')
  // People with a link first, as when the sheet opened: a row does not jump away when its link is created or revoked.
  const [linkedFirst] = useState(() => new Set(Object.keys(state.personalLinks ?? {})))
  const people = sortedPeople(state, lang)
  const shown = [...people.filter(({ id }) => linkedFirst.has(id)), ...people.filter(({ id }) => !linkedFirst.has(id))].filter(({ name }) =>
    matchesSearch(name, query),
  )

  return (
    <div className="space-y-3">
      <p className="text-muted">{t('personal.intro')}</p>
      {people.length >= SEARCH_FROM && <SearchInput value={query} onChange={setQuery} label={t('people.search')} />}
      {shown.length > 0 ? (
        <ul className="divide-y divide-line">
          {shown.map(({ id }) => (
            <li key={id}>
              <PersonalLinkRow state={state} personId={id} mutate={mutate} />
            </li>
          ))}
        </ul>
      ) : (
        query && <p className="py-4 text-center text-muted">{t('people.noResults', { query })}</p>
      )}
    </div>
  )
}
