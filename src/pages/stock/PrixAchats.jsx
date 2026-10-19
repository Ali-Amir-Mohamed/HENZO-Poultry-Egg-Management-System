import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { must, useQuery } from '../../hooks'
import Icon from '../../components/Icon'
import { day, Empty, Loading, money, Panel } from '../../components/ui'

// Purchase prices of each stocked item: last price and how it moved, average over 3 months,
// the cheapest supplier, and the history. A purchase 10 % above the recent ones alerts the partners (database).
const TROIS_MOIS = 92

export default function PrixAchats() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const [cat, setCat] = useState('')
  const [ouvert, setOuvert] = useState(null)
  const q = useQuery(async () => must(await supabase.from('prix_achats').select('*').order('date_depense', { ascending: false }).limit(500)))
  if (!q.data) return <Panel icon="tag" tone="yolk" title={t('prix.title')}><Loading error={q.error} /></Panel>

  const limite = new Date(); limite.setDate(limite.getDate() - TROIS_MOIS)
  const parArticle = Object.values(q.data.reduce((m, p) => {
    (m[p.article_id] ??= { id: p.article_id, nom: p.article, categorie: p.categorie, unite: p.unite, achats: [] }).achats.push(p)
    return m
  }, {})).filter((a) => !cat || a.categorie === cat).sort((a, b) => a.nom.localeCompare(b.nom))
  const categories = [...new Set(q.data.map((p) => p.categorie))]
  const fp = (n) => `${Number(n).toLocaleString(lang, { maximumFractionDigits: 0 })} F`

  const resume = (a) => {
    const [dernier, avant] = a.achats
    const recents = a.achats.filter((p) => new Date(`${p.date_depense}T00:00`) >= limite)
    const moyenne = recents.length ? recents.reduce((s, p) => s + Number(p.montant), 0) / recents.reduce((s, p) => s + Number(p.quantite), 0) : null
    const parFour = Object.values(recents.filter((p) => p.fournisseur).reduce((m, p) => {
      const x = (m[p.fournisseur_id] ??= { nom: p.fournisseur, q: 0, m: 0 }); x.q += Number(p.quantite); x.m += Number(p.montant); return m
    }, {})).map((x) => ({ ...x, prix: x.m / x.q })).sort((x, y) => x.prix - y.prix)
    const evol = avant ? Math.round((Number(dernier.prix_unitaire) / Number(avant.prix_unitaire) - 1) * 100) : null
    return { dernier, moyenne, moinsCher: parFour.length > 1 ? parFour[0] : null, evol }
  }

  return (
    <Panel icon="tag" tone="yolk" title={t('prix.title')} subtitle={t('prix.subtitle')}
      actions={categories.length > 1 && (
        <select value={cat} onChange={(e) => setCat(e.target.value)} className="select-sm">
          <option value="">{t('prix.all')}</option>
          {categories.map((c) => <option key={c} value={c}>{t(`articleCategories.${c}`)}</option>)}
        </select>
      )}>
      {parArticle.length === 0 ? <Empty icon="tag" text={t('prix.none')} /> : (
        <ul className="list">
          {parArticle.map((a) => {
            const r = resume(a)
            return (
              <li key={a.id}>
                <div className="grow">
                  <strong>{a.nom}</strong>
                  <div className="muted small">
                    {[t('prix.last', { prix: fp(r.dernier.prix_unitaire), unite: t(`unites.${a.unite}`), d: day(r.dernier.date_depense, lang) }) + (r.dernier.fournisseur ? ` · ${r.dernier.fournisseur}` : ''),
                      r.moyenne != null && t('prix.average', { prix: fp(r.moyenne) })].filter(Boolean).join(' · ')}
                  </div>
                  {r.moinsCher && <div className="small ok-text"><Icon name="check" size={13} /> {t('prix.cheapest', { nom: r.moinsCher.nom, prix: fp(r.moinsCher.prix) })}</div>}
                  <div className="row-actions"><button className="btn ghost sm" onClick={() => setOuvert(ouvert === a.id ? null : a.id)}>{t(ouvert === a.id ? 'relances.hide' : 'prix.history', { count: a.achats.length })}</button></div>
                  {ouvert === a.id && (
                    <ul className="list sub">
                      {a.achats.map((p) => (
                        <li key={p.depense_id}>
                          <div className="grow">{day(p.date_depense, lang)} · {p.fournisseur ?? t('prix.noSupplier')} · {Number(p.quantite).toLocaleString(lang)} {t(`unites.${a.unite}`)}</div>
                          <strong>{fp(p.prix_unitaire)}</strong>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="right">
                  <strong>{fp(r.dernier.prix_unitaire)}</strong>
                  {r.evol != null && r.evol !== 0 && <span className={`tag ${r.evol >= 10 ? 'danger' : r.evol > 0 ? 'warn' : 'ok'}`}>{r.evol > 0 ? '+' : ''}{r.evol} %</span>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <p className="muted small">{t('prix.alertHint')}</p>
    </Panel>
  )
}
