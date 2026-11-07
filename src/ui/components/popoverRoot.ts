import { createContext, type RefObject } from 'react'

/** The open modal dialog around (set by Dialog): popovers inside it are attached to it, since everything outside it is inert. */
export const PopoverRoot = createContext<RefObject<HTMLElement | null> | null>(null)
