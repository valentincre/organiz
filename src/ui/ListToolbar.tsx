import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '../i18n/context'
import { CloseIcon, FilterIcon, MoreIcon, PlusIcon, SearchIcon, SortIcon } from './components/icons'
import { Menu, type MenuItem } from './components/Menu'
import { SearchInput } from './components/SearchInput'
import { button, cx } from './components/styles'
import { FilterBar, type FilterBarProps } from './properties/FilterBar'
import { useMediaQuery } from './useMediaQuery'

interface Props {
  query: string
  onQueryChange: (query: string) => void
  searchLabel: string
  /** Enter in the search field, e.g. to add the typed name. */
  onSubmit?: () => void
  filter: Omit<FilterBarProps, 'addButton' | 'open' | 'onOpenChange' | 'anchor' | 'leading'>
  /** Sort choices; no Sort button without them. */
  sort?: MenuItem[]
  /** A sort other than the default is chosen. */
  sorted?: boolean
  /** Extra buttons before the ⋯ menu. */
  actions?: ReactNode
  /** Other actions, in a ⋯ menu. */
  more?: MenuItem[]
  /** Toggles drawn as pills before the filters, e.g. "Show people who left". */
  pills?: ReactNode
  /**
   * Phones: the search folds into a magnifier button and `count` (e.g. "86
   * events") takes its place. For lists where searching is not the main action.
   */
  foldedSearch?: { count: string }
}

/**
 * The bar above lists (events, attendance sheet, people, a person's events):
 * search (or add), Filter with its pills, Sort and a menu of other actions. Sticks
 * to the top of the screen while the list scrolls.
 */
export function ListToolbar({ query, onQueryChange, searchLabel, onSubmit, filter, sort, sorted = false, actions, more, pills, foldedSearch }: Props) {
  const { t } = useI18n()
  const filterButton = useRef<HTMLButtonElement>(null)
  const searchField = useRef<HTMLInputElement>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const phone = useMediaQuery('(width < 40rem)')
  const folds = Boolean(foldedSearch) && phone
  const folded = folds && !searching
  const active = filter.filter.length + (filter.status?.value != null ? 1 : 0)
  const typed = query.trim()

  // The field opens with the keyboard.
  useEffect(() => {
    if (folds && searching) searchField.current?.focus()
  }, [folds, searching])

  // While folded, the search shows as a pill next to the filters, and the count replaces their summary.
  const searchPill = folded && typed && (
    <span className="inline-flex max-w-full items-center rounded-full border border-accent/50 bg-accent-soft text-sm">
      <button type="button" className="min-h-8 min-w-0 cursor-pointer truncate py-1 pr-1 pl-3 text-left" onClick={() => setSearching(true)}>
        {t('search.pill', { query: typed })}
      </button>
      <button
        type="button"
        className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted hover:text-text"
        aria-label={t('search.clear')}
        onClick={() => onQueryChange('')}
      >
        <CloseIcon small />
      </button>
    </span>
  )

  return (
    <div className="sticky top-0 z-10 -mx-4 space-y-2 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur lg:mx-0 lg:px-0">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (folds) setSearching(false)
          onSubmit?.()
        }}
      >
        {folded ? (
          <>
            <span className="min-w-0 flex-1 self-center truncate text-sm text-muted">{foldedSearch?.count}</span>
            <button
              type="button"
              className={cx(button(typed ? 'active' : 'default'), 'relative w-10 shrink-0 px-0')}
              aria-label={typed ? t('search.openActive', { query: typed }) : searchLabel}
              title={searchLabel}
              onClick={() => setSearching(true)}
            >
              <SearchIcon />
              {typed && <span className="absolute -top-1 -right-1 size-2.5 rounded-full border-2 border-bg bg-accent" aria-hidden="true" />}
            </button>
          </>
        ) : (
          <div className="min-w-0 flex-1">
            <SearchInput
              value={query}
              onChange={onQueryChange}
              label={searchLabel}
              inputRef={searchField}
              onKeyDown={(e) => {
                // Escape folds the field back and keeps the text (it would clear it otherwise).
                if (folds && e.key === 'Escape') {
                  e.preventDefault()
                  setSearching(false)
                }
              }}
              onBlur={() => folds && setSearching(false)}
            />
          </div>
        )}
        {folds && searching ? (
          <button type="button" className="inline-flex min-h-10 shrink-0 cursor-pointer items-center px-2 font-medium text-accent hover:text-accent-hover" onClick={() => setSearching(false)}>
            {t('search.close')}
          </button>
        ) : (
          <>
            <button
              ref={filterButton}
              type="button"
              className={cx(button(filterOpen || active > 0 ? 'active' : 'default'), 'relative shrink-0 px-3 max-sm:w-10 max-sm:px-0')}
              aria-expanded={filterOpen}
              title={t('filter.add')}
              onClick={() => setFilterOpen(!filterOpen)}
            >
              <FilterIcon />
              <span className="max-sm:sr-only">{t('filter.add')}</span>
              {/* A badge on the corner, so the button keeps its size. */}
              {active > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-xs font-semibold text-on-accent tabular-nums">
                  <span className="sr-only">{t('filter.activeCount', { count: active })}</span>
                  <span aria-hidden="true">{active}</span>
                </span>
              )}
            </button>
            {sort && <Menu label={t('sheet.sortBy')} heading={t('sheet.sortBy')} icon={<SortIcon />} text={t('sheet.sort')} active={sorted} items={sort} />}
            {actions}
            {more && <Menu label={t('sheet.more')} icon={<MoreIcon />} items={more} />}
          </>
        )}
      </form>
      <FilterBar
        {...filter}
        summary={folds ? undefined : filter.summary}
        leading={searchPill || pills ? (
          <>
            {searchPill}
            {pills}
          </>
        ) : undefined}
        addButton={false}
        open={filterOpen}
        onOpenChange={setFilterOpen}
        anchor={filterButton}
      />
    </div>
  )
}

/** First row of a list while a name nobody has is typed: adds it (or does what the label says). */
export function AddCandidateRow({ label, disabled = false, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        className="flex min-h-touch w-full cursor-pointer items-center gap-3 bg-accent-soft px-4 py-2 text-left font-medium text-accent disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled}
        onClick={onClick}
      >
        <PlusIcon />
        <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
      </button>
    </li>
  )
}
