import { useState, type Ref } from 'react'
import { matchesSearch } from '../domain/matching'
import type { Answer, PersonId, Reply } from '../domain/types'
import { useI18n } from '../i18n/context'
import { ChevronIcon, LockIcon } from '../ui/components/icons'
import { SearchInput } from '../ui/components/SearchInput'
import { cx } from '../ui/components/styles'

/** Beyond this many names, a search field is shown above the list. */
const SEARCH_FROM = 10

const tagTone = { yes: 'bg-success-soft text-success', no: 'bg-danger-soft text-danger', none: 'text-muted' } as const

/** A person's answer as a small label: "Coming", "No" or "no reply". */
export function AnswerTag({ answer }: { answer: Answer | undefined }) {
  const { t } = useI18n()
  const value = answer ?? 'none'
  return (
    <span className={cx('inline-flex h-7 shrink-0 items-center rounded-full px-3 text-[13px] font-semibold whitespace-nowrap', tagTone[value])}>
      {t(value === 'yes' ? 'reply.yes' : value === 'no' ? 'reply.no' : 'reply.none')}
    </span>
  )
}

/** A name that answers through its personal link only. */
function LockedTag() {
  const { t } = useI18n()
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-[13px] text-muted">
      <LockIcon small />
      {t('reply.page.locked')}
    </span>
  )
}

function YouTag() {
  const { t } = useI18n()
  return <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 align-middle text-xs font-semibold text-accent">{t('reply.page.you')}</span>
}

interface Props {
  people: { id: PersonId; name: string; locked?: true }[]
  /** Public links: everyone's answer, shown on each row. Private links: undefined, names only. */
  answers?: Record<PersonId, Reply>
  /** The names this phone answered for, tagged "you". */
  mine: Set<PersonId>
  /** Opens the answer sheet of a name; rows are plain text when replies are closed. */
  onPick?: (personId: PersonId) => void
  searchRef?: Ref<HTMLInputElement>
}

/** The names of a reply link, with a search field when there are many. */
export function NameList({ people, answers, mine, onPick, searchRef }: Props) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const shown = query.trim() ? people.filter((person) => matchesSearch(person.name, query)) : people
  const rowClass = 'flex min-h-touch w-full items-center gap-3 px-4 py-2 text-left'

  return (
    <div className="space-y-3">
      {people.length > SEARCH_FROM && <SearchInput value={query} onChange={setQuery} label={t('reply.page.search')} inputRef={searchRef} />}
      {shown.length === 0 ? (
        <p className="py-6 text-center text-muted">{t('reply.page.noMatch')}</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {shown.map((person) => {
            const content = (
              <>
                {/* A locked row wraps on its name's full width (flex-auto), so the tags move rather than squeeze it. */}
                <span className={cx('min-w-0 font-medium [overflow-wrap:anywhere]', person.locked ? 'flex-auto' : 'flex-1')}>
                  {person.name}
                  {mine.has(person.id) && <YouTag />}
                </span>
                {person.locked ? (
                  // Two tags leave little room for the name on phones: they go below it, on the right.
                  <span className="ml-auto flex shrink-0 items-center gap-3">
                    {answers && <AnswerTag answer={answers[person.id]} />}
                    <LockedTag />
                  </span>
                ) : (
                  answers && <AnswerTag answer={answers[person.id]} />
                )}
                {onPick && !answers && !person.locked && (
                  <span className="text-muted">
                    <ChevronIcon direction="right" small />
                  </span>
                )}
              </>
            )
            return (
              <li key={person.id}>
                {onPick && !person.locked ? (
                  <button type="button" className={cx(rowClass, 'cursor-pointer text-text hover:bg-surface-muted')} onClick={() => onPick(person.id)}>
                    {content}
                  </button>
                ) : (
                  <div className={cx(rowClass, person.locked && 'flex-wrap gap-y-1')}>{content}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
