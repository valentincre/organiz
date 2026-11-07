import { useState } from 'react'
import { useCanEdit } from '../canEdit'
import { cx, input } from './styles'
import { PencilIcon } from './icons'

interface Props {
  value: string
  onChange: (value: string) => void
  /** Accessible name of the text field. */
  label: string
  /** Tooltip of the heading button. */
  editLabel: string
  maxLength: number
  /** Shown, muted, when the value is empty. */
  placeholder?: string
  /** Lets the user clear the value (optional names). */
  allowEmpty?: boolean
  as?: 'h1' | 'h2'
}

/** Heading with a pencil that turns into a text field on click; Enter or blur saves, Escape cancels. Plain text for readers. */
export function EditableTitle({ value, onChange, label, editLabel, maxLength, placeholder, allowEmpty = false, as: Heading = 'h1' }: Props) {
  const canEdit = useCanEdit()
  const [draft, setDraft] = useState<string | null>(null)

  if (!canEdit) {
    return (
      <Heading className="m-0 min-w-0 text-xl font-bold [overflow-wrap:anywhere]">
        <span className={cx(!value && 'text-muted')}>{value || placeholder}</span>
      </Heading>
    )
  }

  if (draft === null) {
    return (
      <Heading className="m-0 min-w-0 text-xl font-bold">
        <button
          type="button"
          className="group -ml-1.5 cursor-text rounded-md px-1.5 py-0.5 text-left [overflow-wrap:anywhere] hover:bg-surface-muted"
          title={editLabel}
          onClick={() => setDraft(value)}
        >
          <span className={cx(!value && 'text-muted')}>{value || placeholder}</span>
          {/* Kept on the same line as the last word. */}
          <span className="ml-2 inline-block align-[-0.05em] whitespace-nowrap text-muted group-hover:text-text">
            <PencilIcon small />
          </span>
        </button>
      </Heading>
    )
  }

  const commit = () => {
    const next = draft.trim()
    if ((next || allowEmpty) && next !== value) onChange(next)
    setDraft(null)
  }

  return (
    <input
      className={cx(input, 'min-w-0 flex-[1_1_240px] text-xl font-bold')}
      aria-label={label}
      value={draft}
      placeholder={placeholder}
      autoFocus
      maxLength={maxLength}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setDraft(null)
      }}
    />
  )
}
