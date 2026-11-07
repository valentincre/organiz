import type { ColorKey } from '../../domain/types'

// Shared Tailwind class strings for elements that look the same everywhere
// (buttons are rendered as <button> or <a>, so a component would not fit both).

export const cx = (...classes: (string | false | null | undefined)[]): string => classes.filter(Boolean).join(' ')

// `active` is a default button that is on (an open menu, a filter in use). A
// variant rather than extra classes: two classes setting the same property
// apply in stylesheet order, not in the order they are written.
type ButtonVariant = 'default' | 'active' | 'primary' | 'danger'

const buttonVariants: Record<ButtonVariant, string> = {
  default: 'border-line bg-surface text-text hover:bg-surface-muted',
  active: 'border-accent bg-surface text-accent hover:bg-surface-muted',
  primary: 'border-accent bg-accent text-on-accent hover:border-accent-hover hover:bg-accent-hover',
  danger: 'border-line bg-surface text-danger hover:bg-danger-soft',
}

export const button = (variant: ButtonVariant = 'default'): string =>
  cx(
    'inline-flex min-h-10 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md border px-3.5 font-medium no-underline',
    'disabled:cursor-not-allowed disabled:opacity-55',
    buttonVariants[variant],
  )

export const linkButton = 'cursor-pointer text-accent underline'

/** Field look without a width, for selects that size to their content. */
export const inputBase = 'min-h-10 rounded-md border border-line bg-surface px-2.5 py-1.5 text-text placeholder:text-muted'

export const input = `${inputBase} w-full`

export const cardFrame = 'rounded-xl border border-line bg-surface shadow-sm'

export const card = `${cardFrame} p-5`

// Option colors of custom properties, written out in full so Tailwind generates them.
export const optionChip: Record<ColorKey, string> = {
  blue: 'bg-opt-blue-soft text-opt-blue',
  green: 'bg-opt-green-soft text-opt-green',
  amber: 'bg-opt-amber-soft text-opt-amber',
  red: 'bg-opt-red-soft text-opt-red',
  purple: 'bg-opt-purple-soft text-opt-purple',
  teal: 'bg-opt-teal-soft text-opt-teal',
  pink: 'bg-opt-pink-soft text-opt-pink',
  gray: 'bg-opt-gray-soft text-opt-gray',
}

export const optionDot: Record<ColorKey, string> = {
  blue: 'bg-opt-blue',
  green: 'bg-opt-green',
  amber: 'bg-opt-amber',
  red: 'bg-opt-red',
  purple: 'bg-opt-purple',
  teal: 'bg-opt-teal',
  pink: 'bg-opt-pink',
  gray: 'bg-opt-gray',
}
