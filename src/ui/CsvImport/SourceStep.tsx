import { useState } from 'react'
import { decodeText } from '../../csv/decode'
import { parseTable, type Table } from '../../csv/parse'
import { useI18n } from '../../i18n/context'
import { button, cx, input } from '../components/styles'

export function SourceStep({ onTable }: { onTable: (table: Table) => void }) {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = (content: string) => {
    const table = parseTable(content)
    if (table.length === 0) setError(t('csv.source.empty'))
    else onTable(table)
  }

  const readFile = async (file: File | undefined) => {
    if (!file) return
    try {
      load(decodeText(new Uint8Array(await file.arrayBuffer())))
    } catch {
      setError(t('csv.source.readError'))
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className={cx(button('primary'), 'w-full')}>
          {t('csv.source.file')}
          <input
            type="file"
            accept=".csv,.txt,.tsv,text/csv,text/plain"
            className="sr-only"
            onChange={(e) => void readFile(e.target.files?.[0])}
          />
        </label>
        <p className="mt-1 text-sm text-muted">{t('csv.source.fileHint')}</p>
      </div>

      <div className="flex items-center gap-3 text-sm text-muted">
        <span className="h-px flex-1 bg-line" />
        {t('csv.source.or')}
        <span className="h-px flex-1 bg-line" />
      </div>

      <div className="space-y-2">
        <textarea
          className={cx(input, 'min-h-36 font-mono text-sm')}
          aria-label={t('csv.source.paste')}
          placeholder={t('csv.source.pastePlaceholder')}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setError(null)
          }}
        />
        <div className="flex justify-end">
          <button type="button" className={button()} disabled={!text.trim()} onClick={() => load(text)}>
            {t('csv.continue')}
          </button>
        </div>
      </div>

      {error && (
        <p className="text-sm font-medium text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
