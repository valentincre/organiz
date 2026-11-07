import { useState } from 'react'
import { buildAttendanceCsv, buildEventsCsv, buildPeopleCsv, exportFileName } from '../csv/exportCsv'
import { todayIso } from '../domain/dates'
import type { DashboardState, IsoDate } from '../domain/types'
import { useI18n } from '../i18n/context'
import type { MessageKey } from '../i18n/en'
import { backupFileName, backupJson } from '../storage/backup'
import { Dialog } from './components/Dialog'
import { button, cx, input } from './components/styles'
import { downloadFile } from './download'

type CsvKind = 'attendance' | 'events' | 'people'
type Kind = CsvKind | 'backup'
const KINDS: Kind[] = ['attendance', 'events', 'people', 'backup']
const BUILDERS = { attendance: buildAttendanceCsv, events: buildEventsCsv, people: buildPeopleCsv }

interface Props {
  open: boolean
  onClose: () => void
  state: DashboardState
}

export function ExportDialog({ open, onClose, state }: Props) {
  const { t, lang } = useI18n()
  const [from, setFrom] = useState<IsoDate>()
  const [to, setTo] = useState<IsoDate>()
  const [kind, setKind] = useState<Kind>('attendance')
  const invalid = kind !== 'backup' && Boolean(from && to && from > to)

  const download = () => {
    if (kind === 'backup') {
      downloadFile(backupFileName(state.name, todayIso()), [backupJson(state)], 'application/json')
    } else {
      downloadCsv(kind)
    }
    onClose()
  }

  const downloadCsv = (csvKind: CsvKind) => {
    const csv = BUILDERS[csvKind](state, {
      locale: lang,
      delimiter: lang === 'fr' ? ';' : ',',
      headers: {
        name: t('export.name'),
        total: t('export.total'),
        date: t('event.date'),
        start: t('export.start'),
        end: t('export.end'),
        event: t('export.event'),
        yes: t('export.yes'),
        no: t('export.no'),
        called: t('export.called'),
        present: t('export.present'),
      },
      from,
      to,
    })
    // The BOM makes Excel read accents correctly.
    downloadFile(exportFileName(state.name, t(`export.kind.${csvKind}` as MessageKey), todayIso()), ['\uFEFF', csv], 'text/csv;charset=utf-8')
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('export.title')} closeLabel={t('csv.close')}>
      <div className="space-y-4">
        <fieldset className="space-y-1">
          <legend className="mb-1 font-medium">{t('export.what')}</legend>
          {KINDS.map((value) => (
            <label key={value} className={cx('flex cursor-pointer gap-2 rounded-lg border p-2.5', kind === value ? 'border-accent bg-accent-soft' : 'border-line')}>
              <input type="radio" name="export-kind" className="mt-1 accent-accent" checked={kind === value} onChange={() => setKind(value)} />
              <span>
                <span className="block font-medium">{t(`export.kind.${value}` as MessageKey)}</span>
                <span className="block text-sm text-muted">{t(`export.kindHint.${value}` as MessageKey)}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {kind !== 'backup' && (
          <>
          <p className="text-sm text-muted">{t('export.periodHint')}</p>
          <div className="flex flex-wrap gap-3">
            <label className="grid w-44 gap-1 text-sm font-medium">
              {t('range.from')}
              <input type="date" className={input} value={from ?? ''} onChange={(e) => setFrom(e.target.value || undefined)} />
            </label>
            <label className="grid w-44 gap-1 text-sm font-medium">
              {t('range.to')}
              <input
                type="date"
                className={input}
                value={to ?? ''}
                min={from}
                onChange={(e) => setTo(e.target.value || undefined)}
              />
            </label>
          </div>
          {invalid && (
            <p className="font-medium text-danger" role="alert">
              {t('range.invalid')}
            </p>
          )}
          </>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={button()} onClick={onClose}>
            {t('export.cancel')}
          </button>
          <button type="button" className={button('primary')} disabled={invalid} onClick={download}>
            {t('export.download')}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
