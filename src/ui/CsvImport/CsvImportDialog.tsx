import { useState } from 'react'
import type { ColumnMapping } from '../../csv/importPlan'
import type { ImportRecord, Table } from '../../csv/parse'
import type { DashboardState, EventId, Mutation } from '../../domain/types'
import { useI18n } from '../../i18n/context'
import { Dialog } from '../components/Dialog'
import { useToast } from '../components/toast'
import { ColumnStep } from './ColumnStep'
import { MatchStep } from './MatchStep'
import { SourceStep } from './SourceStep'

type Step =
  | { kind: 'source' }
  | { kind: 'columns'; table: Table }
  | { kind: 'match'; table: Table; records: ImportRecord[]; mappings: ColumnMapping[] }

interface Props {
  open: boolean
  onClose: () => void
  state: DashboardState
  /** Import into this event's attendance; without it, import people and their properties only. */
  eventId?: EventId
  /** A roll call of this event is in progress on this device. */
  callInProgress?: boolean
  mutate: (mutation: Mutation) => void
}

export function CsvImportDialog({ open, onClose, state, eventId, callInProgress, mutate }: Props) {
  const { t } = useI18n()
  const toast = useToast()
  const [step, setStep] = useState<Step>({ kind: 'source' })

  const close = () => {
    setStep({ kind: 'source' })
    onClose()
  }

  return (
    <Dialog open={open} onClose={close} title={t(eventId ? 'csv.title' : 'csv.titlePeople')} closeLabel={t('csv.close')}>
      {step.kind === 'source' && <SourceStep onTable={(table) => setStep({ kind: 'columns', table })} />}
      {step.kind === 'columns' && (
        <ColumnStep
          state={state}
          table={step.table}
          onBack={() => setStep({ kind: 'source' })}
          onNext={(records, mappings) => setStep({ kind: 'match', table: step.table, records, mappings })}
        />
      )}
      {step.kind === 'match' && (
        <MatchStep
          state={state}
          eventId={eventId}
          callInProgress={callInProgress}
          records={step.records}
          mappings={step.mappings}
          onBack={() => setStep({ kind: 'columns', table: step.table })}
          onDone={(mutation, summary) => {
            mutate(mutation)
            const done = t(summary.attendance === 'present' ? 'csv.done' : summary.attendance === 'yes' ? 'csv.doneYes' : 'csv.donePeople', { count: summary.people })
            toast([done, summary.created > 0 && t('csv.doneCreated', { count: summary.created })].filter(Boolean).join(' '))
            close()
          }}
        />
      )}
    </Dialog>
  )
}
