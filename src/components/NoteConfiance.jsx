import { useTranslation } from 'react-i18next'

// Client trust score (database view confiance_clients): A very good payer … D risky, « nouveau » without credit history
const TON = { A: 'ok', B: 'ok', C: 'warn', D: 'danger', nouveau: '' }

export default function NoteConfiance({ note }) {
  const { t } = useTranslation()
  if (!note) return null
  return <span className={`tag ${TON[note] ?? ''}`} title={t(`confiance.hint.${note}`)}>{note === 'nouveau' ? t('confiance.label.nouveau') : `${note} · ${t(`confiance.label.${note}`)}`}</span>
}
