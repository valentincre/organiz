/** Saves `content` as a file named `fileName`, through a temporary link. */
export function downloadFile(fileName: string, content: BlobPart[], type: string): void {
  const url = URL.createObjectURL(new Blob(content, { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
