import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import Icon from '../../components/Icon'
import { Panel } from '../../components/ui'

// Backup (director): readable copy of all data, downloaded as a JSON file.
// The automatic weekly encrypted backup runs on GitHub (see docs/RESTAURATION.md).
const TABLES = ['fermes', 'profiles', 'batiments', 'tiers', 'articles', 'prix_vente', 'bandes', 'commandes_poussins', 'livraisons_poussins', 'lots_pondeuses',
  'mortalites', 'pontes', 'pesees', 'observations', 'mouvements_stock', 'caisses', 'ventes', 'paiements_clients',
  'depenses', 'paiements_fournisseurs', 'ecritures', 'bilans_bandes', 'investisseurs', 'operations_investisseurs',
  'distributions_investisseurs', 'prets', 'echeances_prets', 'remboursements_prets', 'verifications_caisse',
  'transferts_caisses', 'modeles_taches', 'taches', 'taches_realisations', 'notifications', 'journal_activite']

async function fetchAll(table) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + 999)
    if (error) throw new Error(`${table} : ${error.message}`)
    rows.push(...data)
    if (data.length < 1000) return rows
  }
}

export default function Sauvegarde() {
  const { t } = useTranslation()
  const [state, setState] = useState({ busy: false, progress: '', error: null, done: null })

  const exporter = async () => {
    setState({ busy: true, progress: '', error: null, done: null })
    try {
      const data = {}
      for (const [i, table] of TABLES.entries()) {
        setState((s) => ({ ...s, progress: `${i + 1}/${TABLES.length} · ${table}` }))
        data[table] = await fetchAll(table)
      }
      const total = Object.values(data).reduce((s, rows) => s + rows.length, 0)
      const file = new Blob([JSON.stringify({ exporte_le: new Date().toISOString(), application: 'HENZO', tables: data }, null, 1)],
        { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(file)
      a.download = `henzo-donnees-${new Date().toLocaleDateString('en-CA')}.json`
      a.click()
      URL.revokeObjectURL(a.href)
      setState({ busy: false, progress: '', error: null, done: t('sauvegarde.done', { n: total }) })
    } catch (e) {
      setState({ busy: false, progress: '', error: e.message, done: null })
    }
  }

  return (
    <>
      <Panel icon="download" tone="green" title={t('sauvegarde.exportTitle')} subtitle={t('sauvegarde.exportHint')}>
        {state.error && <div className="alert danger"><Icon name="alert" size={18} />{state.error}</div>}
        {state.done && <div className="alert success"><Icon name="check" size={18} />{state.done}</div>}
        <button className="btn primary block" onClick={exporter} disabled={state.busy}>
          <Icon name="download" size={18} />{state.busy ? `${t('common.loading')} ${state.progress}` : t('sauvegarde.export')}
        </button>
      </Panel>
      <Panel icon="shield" tone="sky" title={t('sauvegarde.autoTitle')}>
        <p>{t('sauvegarde.autoText')}</p>
        <p className="muted small">{t('sauvegarde.autoWhere')}</p>
      </Panel>
    </>
  )
}
