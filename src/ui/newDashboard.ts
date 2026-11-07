// Remembers, for this page session, which dashboard was just created so it
// shows the "save this link" banner until dismissed. Not cleared on read:
// StrictMode runs state initializers twice.
let justCreated: string | null = null

export const markJustCreated = (docId: string): void => {
  justCreated = docId
}

export const isJustCreated = (docId: string): boolean => justCreated === docId

export const clearJustCreated = (): void => {
  justCreated = null
}
