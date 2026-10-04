import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { must, useQuery } from '../../hooks'
import { Loading, money, Panel } from '../../components/ui'

// Activity log (director): who did what, when — filled automatically by the database
const TABLES = ['', 'ventes', 'depenses', 'ecritures', 'paiements_clients', 'paiements_fournisseurs', 'bandes', 'livraisons_poussins', 'lots_pondeuses',
  'operations_investisseurs', 'distributions_investisseurs', 'prets', 'remboursements_prets', 'verifications_caisse',
  'transferts_caisses', 'tiers', 'prix_vente', 'profiles', 'fermes']
const IGNORED = ['created_at', 'annulee_le', 'valide_le', 'decide_le', 'fait_le']

export default function Journal() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const [table, setTable] = useState('')
  const [limit, setLimit] = useState(100)

  const q = useQuery(async () => {
    let req = supabase.from('journal_activite').select('*').order('created_at', { ascending: false }).limit(limit)
    if (table) req = req.eq('table_nom', table)
    const [rows, users] = await Promise.all([req, supabase.from('profiles').select('id, nom_complet, identifiant')])
    const names = Object.fromEntries(must(users).map((u) => [u.id, u.nom_complet || u.identifiant]))
    return { rows: must(rows), names }
  }, [table, limit])

  return (
    <Panel icon="note" tone="sky" title={t('journal.title')} subtitle={t('journal.subtitle')}
      actions={(
        <select className="inline-select" value={table} onChange={(e) => setTable(e.target.value)}>
          {TABLES.map((x) => <option key={x} value={x}>{x ? t(`journal.tables.${x}`) : t('journal.all')}</option>)}
        </select>
      )}>
      {!q.data ? <Loading error={q.error} /> : q.data.rows.length === 0 ? <p className="muted">{t('journal.empty')}</p> : (
        <>
          <ul className="list journal">
            {q.data.rows.map((r) => (
              <li key={r.id}>
                <div className="grow">
                  <strong>{t(`journal.actions.${r.action}`)} · {t(`journal.tables.${r.table_nom}`, r.table_nom)}</strong>
                  <div className="muted small">
                    {new Date(r.created_at).toLocaleString(lang)} · {r.user_id ? (q.data.names[r.user_id] ?? '?') : t('journal.system')}
                  </div>
                  <div className="small">{describe(r, t, lang)}</div>
                </div>
              </li>
            ))}
          </ul>
          {q.data.rows.length === limit && (
            <button className="btn ghost block" onClick={() => setLimit(limit + 100)}>{t('journal.more')}</button>
          )}
        </>
      )}
    </Panel>
  )
}

// Short human summary: key fields for a creation, changed fields for an update
function describe(r, t, lang) {
  const d = r.details ?? {}
  const fmt = (k, v) => (v == null ? '—' : ['montant', 'montant_initial', 'prix', 'prix_unitaire'].includes(k) ? money(v, lang) : String(v))
  if (r.action === 'UPDATE' && d.avant && d.apres) {
    const changes = Object.keys(d.apres)
      .filter((k) => !IGNORED.includes(k) && JSON.stringify(d.avant[k]) !== JSON.stringify(d.apres[k]))
      .map((k) => `${k} : ${fmt(k, d.avant[k])} → ${fmt(k, d.apres[k])}`)
    return changes.join(' · ') || t('journal.noChange')
  }
  const keys = ['code', 'libelle', 'nom', 'produit', 'nature', 'type_operation', 'statut', 'role', 'montant', 'montant_initial', 'prix', 'motif', 'motif_annulation']
  return keys.filter((k) => d[k] != null).map((k) => `${k} : ${fmt(k, d[k])}`).join(' · ')
}
