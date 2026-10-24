import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { must, useQuery } from '../hooks'
import { localDate } from '../lib/stats'
import Icon from './Icon'
import { day, Panel } from './ui'
import { useAsk, useRun } from './Dialog'

// A flock's own stock of feed and medicines (exploitation, director). Goods are put in from the general stock;
// counting what is left tells HENZO what the flock ate since the last count (spread over the days by the database).
// What is left at the end goes to another flock or back to the general stock.
export default function StockBande({ bande }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const ask = useAsk()
  const run = useRun()
  const n = (v) => Number(v ?? 0).toLocaleString(lang, { maximumFractionDigits: 3 })
  const unite = (u, q) => t(Math.abs(Number(q)) >= 2 ? `unitesPl.${u}` : `unites.${u}`)
  const [comptage, setComptage] = useState(null) // { date, restes: { article_id: value } }
  const [resultat, setResultat] = useState(null)

  const q = useQuery(async () => {
    const [lignes, toutes, stock, bandes] = await Promise.all([
      supabase.from('stock_bandes').select('*').eq('bande_id', bande.id).order('nom'),
      supabase.from('stock_bandes').select('article_id, reste'),
      supabase.from('stock_articles').select('article_id, nom, unite, stock').order('nom'),
      supabase.from('bandes').select('id, code').neq('statut', 'cloturee').neq('id', bande.id).order('date_arrivee')
    ])
    const dansBandes = {}
    for (const l of must(toutes)) dansBandes[l.article_id] = (dansBandes[l.article_id] ?? 0) + Math.max(Number(l.reste), 0)
    const general = must(stock).map((s) => ({ ...s, libre: Math.round((Number(s.stock) - (dansBandes[s.article_id] ?? 0)) * 1000) / 1000 }))
    return { lignes: must(lignes), general, bandes: must(bandes) }
  }, [bande.id])

  if (!q.data) return null
  const { lignes, general, bandes } = q.data
  const ouverte = bande.statut !== 'cloturee'
  const restants = lignes.filter((l) => Number(l.reste) > 0)

  const mettre = async () => {
    const dispo = general.filter((g) => g.libre > 0)
    if (!dispo.length) return ask.error(t('stockBande.nothingFree'))
    // Everything in the general stock is proposed: change a quantity, or put 0 for what stays in the general stock
    const v = await ask.form({
      title: t('stockBande.putTitle', { code: bande.code }), icon: 'box', submit: t('stockBande.put'),
      message: t('stockBande.putHint'),
      fields: [
        ...dispo.map((g) => ({ name: g.article_id, label: `${g.nom} (${t(`unitesPl.${g.unite}`)}) — ${t('stockBande.free', { n: n(g.libre), unite: unite(g.unite, g.libre) })}`,
          type: 'number', min: 0, max: g.libre, step: '0.001', value: g.libre })),
        { name: 'date', label: t('saisie.date'), type: 'date', value: localDate(), required: true }
      ]
    })
    if (!v) return
    const lignes = dispo.filter((g) => Number(v[g.article_id]) > 0).map((g) => ({ article_id: g.article_id, quantite: Number(v[g.article_id]) }))
    if (!lignes.length) return
    await run(supabase.rpc('mettre_en_stock_bande', { p_bande: bande.id, p_lignes: lignes, p_date: v.date }), q.reload)
  }

  const deplacer = async (l) => {
    const v = await ask.form({
      title: t('stockBande.moveTitle', { nom: l.nom }), icon: 'sync', submit: t('stockBande.move'),
      fields: [
        { name: 'vers', label: t('stockBande.to'), type: 'select', value: bandes[0]?.id ?? '',
          options: [...bandes.map((b) => ({ value: b.id, label: t('stockBande.flockStock', { code: b.code }) })), { value: '', label: t('stockBande.generalStock') }] },
        { name: 'quantite', label: t('stockBande.qtyUnit', { unite: t(`unitesPl.${l.unite}`) }), type: 'number', min: 0.001, step: '0.001', max: Number(l.reste), value: Number(l.reste), required: true }
      ]
    })
    if (!v) return
    await run(supabase.rpc('deplacer_stock_bande', { p_de: bande.id, p_vers: v.vers || null, p_article: l.article_id, p_quantite: Number(v.quantite) }), q.reload)
  }

  // A bag, jerrycan or bottle is empty: one tap. The first time, HENZO asks what it held and remembers it.
  const finir = async (l) => {
    let p_quantite = null
    if (l.contenance) {
      const ok = await ask.confirm(t('stockBande.finishConfirm', { n: n(l.contenance), unite: unite(l.unite, l.contenance), nom: l.nom }),
        { title: t('stockBande.finishTitle', { nom: l.nom }), icon: 'check', submit: t('stockBande.finishYes') })
      if (!ok) return
    } else {
      const v = await ask.form({
        title: t('stockBande.finishTitle', { nom: l.nom }), icon: 'check', submit: t('stockBande.finishYes'),
        message: t('stockBande.finishFirst'),
        fields: [{ name: 'q', label: t('stockBande.heldUnit', { unite: t(`unitesPl.${l.unite}`) }), type: 'number', min: 0.001, step: '0.001', required: true, value: l.unite === 'sac' ? 1 : '' }]
      })
      if (!v) return
      p_quantite = Number(v.q)
    }
    const r = await run(supabase.rpc('finir_contenant', { p_bande: bande.id, p_article: l.article_id, p_quantite }), q.reload)
    if (r && r !== true) setResultat(r)
  }

  const compter = async (e) => {
    e.preventDefault()
    const p = lignes.filter((l) => comptage.restes[l.article_id] !== '' && comptage.restes[l.article_id] != null)
      .map((l) => ({ article_id: l.article_id, reste: Number(comptage.restes[l.article_id]) }))
    if (!p.length) return
    const r = await run(supabase.rpc('compter_stock_bande', { p_bande: bande.id, p_lignes: p, p_date: comptage.date }), q.reload)
    if (r && r !== true) { setResultat(r); setComptage(null) }
  }

  return (
    <Panel icon="box" tone="sky" title={t('stockBande.title', { code: bande.code })} subtitle={t('stockBande.hint')}
      actions={ouverte ? <button className="btn ghost sm" onClick={mettre}><Icon name="plus" size={14} />{t('stockBande.put')}</button> : null}>
      {lignes.length === 0 ? <p className="muted">{t('stockBande.empty')}</p> : (
        <table className="table">
          <thead><tr><th>{t('saisie.article')}</th><th className="num">{t('stockBande.left')}</th><th /></tr></thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.article_id}>
                <td><strong>{l.nom}</strong><div className="muted small">{t('stockBande.receivedUsed', { r: n(l.recu), c: n(l.consomme) })} · {l.dernier_comptage ? t('stockBande.lastFinished', { d: day(l.dernier_comptage, lang) }) : t('stockBande.neverFinished')}</div></td>
                <td className="num"><strong>{n(l.reste)}</strong> {unite(l.unite, l.reste)}</td>
                <td><div className="row" style={{ justifyContent: 'flex-end' }}>
                  {ouverte && Number(l.reste) > 0 && <button className="btn primary sm" onClick={() => finir(l)}><Icon name="check" size={14} />{t('stockBande.finish')}</button>}
                  {Number(l.reste) > 0 && <button className="btn ghost sm" onClick={() => deplacer(l)} title={t('stockBande.move')} aria-label={t('stockBande.move')}><Icon name="sync" size={14} /></button>}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {resultat && (
        <div className="alert success"><Icon name="check" size={18} />
          <div>{resultat.map((r) => (
            <div key={r.article_id}>{Number(r.consomme) > 0
              ? t('stockBande.eaten', { nom: r.nom, n: n(r.consomme), unite: unite(r.unite, r.consomme), du: day(r.du, lang), au: day(r.au, lang), j: Number(r.par_jour).toLocaleString(lang, { maximumFractionDigits: 2 }), uj: t(`unites.${r.unite}`) })
              : t('stockBande.nothingEaten', { nom: r.nom })}</div>
          ))}</div>
        </div>
      )}

      {ouverte && restants.length > 0 && !comptage && (
        <button className="btn ghost block" onClick={() => { setResultat(null); setComptage({ date: localDate(), restes: {} }) }}>
          <Icon name="sync" size={18} />{t('stockBande.count')}
        </button>
      )}
      {comptage && (
        <form className="form" onSubmit={compter}>
          <p className="note"><Icon name="box" size={16} />{t('stockBande.countHint')}</p>
          <label className="field"><span>{t('saisie.date')}</span>
            <input type="date" required max={localDate()} value={comptage.date} onChange={(e) => setComptage({ ...comptage, date: e.target.value })} /></label>
          {restants.map((l) => (
            <label key={l.article_id} className="field">
              <span>{t('stockBande.leftOf', { nom: l.nom, unite: t(`unitesPl.${l.unite}`) })} <span className="muted">· {t('stockBande.expected', { n: n(l.reste) })}</span></span>
              <input type="number" inputMode="decimal" min="0" max={Number(l.reste)} step="0.001"
                value={comptage.restes[l.article_id] ?? ''} onChange={(e) => setComptage({ ...comptage, restes: { ...comptage.restes, [l.article_id]: e.target.value } })} />
            </label>
          ))}
          <div className="row">
            <button type="button" className="btn ghost" onClick={() => setComptage(null)}>{t('dialog.cancel')}</button>
            <button type="submit" className="btn primary" style={{ flex: 1 }}><Icon name="check" size={18} />{t('stockBande.saveCount')}</button>
          </div>
        </form>
      )}
      {!ouverte && restants.length > 0 && <div className="alert warn"><Icon name="alert" size={16} />{t('stockBande.leftAtEnd')}</div>}
      {bande.statut === 'cloture_demandee' && restants.length > 0 && <div className="alert warn"><Icon name="alert" size={16} />{t('stockBande.leftAtEnd')}</div>}
    </Panel>
  )
}
