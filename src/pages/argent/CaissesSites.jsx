import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { useQuery } from '../../hooks'
import { can } from '../../config'
import { money, Panel } from '../../components/ui'

// Cash of every site of the company (direction, finance): each site keeps its own cash boxes,
// this shows the whole company at a glance. Hidden when the company has a single site.
export default function CaissesSites() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const { role } = useAuth()
  const q = useQuery(async () => (can(role, 'caisse.verify') ? (await supabase.rpc('caisses_societe')).data ?? [] : []), [role])
  const lignes = q.data ?? []
  const sites = [...new Map(lignes.map((l) => [l.site_id, l.site])).entries()]
  if (sites.length < 2) return null
  const total = (filtre) => lignes.filter(filtre).reduce((s, l) => s + Number(l.solde), 0)
  return (
    <Panel icon="wallet" tone="sky" title={t('sites.cashTitle')} subtitle={t('sites.cashHint', { n: money(total(() => true), lang) })}>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>{t('sites.site')}</th>{['especes', 'mobile_money', 'banque'].map((m) => <th key={m} className="num">{t(`modes.${m}`)}</th>)}<th className="num">{t('sites.total')}</th></tr></thead>
          <tbody>
            {sites.map(([id, nom]) => (
              <tr key={id}>
                <td>{nom}</td>
                {['especes', 'mobile_money', 'banque'].map((m) => <td key={m} className="num">{money(total((l) => l.site_id === id && l.mode === m), lang)}</td>)}
                <td className="num"><strong>{money(total((l) => l.site_id === id), lang)}</strong></td>
              </tr>
            ))}
            <tr className="strong">
              <td><strong>{t('sites.company')}</strong></td>
              {['especes', 'mobile_money', 'banque'].map((m) => <td key={m} className="num"><strong>{money(total((l) => l.mode === m), lang)}</strong></td>)}
              <td className="num"><strong>{money(total(() => true), lang)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
    </Panel>
  )
}
