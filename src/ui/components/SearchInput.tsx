import type { FocusEventHandler, KeyboardEventHandler, Ref } from 'react'
import { input } from './styles'

interface Props {
  value: string
  onChange: (value: string) => void
  label: string
  inputRef?: Ref<HTMLInputElement>
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>
  onBlur?: FocusEventHandler<HTMLInputElement>
}

export function SearchInput({ value, onChange, label, inputRef, onKeyDown, onBlur }: Props) {
  return (
    <input
      ref={inputRef}
      type="search"
      className={input}
      placeholder={label}
      aria-label={label}
      value={value}
      autoComplete="off"
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    />
  )
}
