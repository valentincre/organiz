import { createContext, useContext } from 'react'

export type ShowToast = (message: string) => void

export const ToastContext = createContext<ShowToast>(() => {})

export const useToast = (): ShowToast => useContext(ToastContext)
