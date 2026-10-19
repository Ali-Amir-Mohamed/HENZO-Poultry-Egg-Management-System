import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { must, useQuery } from '../../hooks'
import { can } from '../../config'
import { localDate } from '../../lib/stats'
import Icon from '../../components/Icon'
import { day, Empty, Field, FormCard, Loading, money, Panel, Tabs } from '../../components/ui'
import { useAsk, useRun } from '../../components/Dialog'

// HENZO AGRO feed mill: formulas for 1 tonne (raw materials in kg, the empty bag, running costs per tonne),
// productions (raw materials and empty bags leave the stock, bags of feed enter it) and the cost price of each bag.
const ligneVide = () => ({ article_id: '', quantite_kg: '' })

export default function Provenderie() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const { role } = useAuth()
  const ask = useAsk()
  const run = useRun()
  const [tab, setTab] = useState('fabriquer')
  const n = (x, d = 0) => Number(x ?? 0).toLocaleString(lang, { maximumFractionDigits: d })
  const q = useQuery(async () => {
    const [art, stock, couts, formules, fabs] = await Promise.all([
      supabase.from('articles').select('id, nom, categorie, unite, poids_unitaire_kg, actif').eq('actif', true).order('nom'),
      supabase.from('stock_articles').select('article_id, stock'),
      supabase.from('cout_moyen_articles').select('article_id, cout_unitaire_moyen'),
      supabase.from('formules_aliment').select('*, lignes:formules_lignes(article_id, quantite_kg)').eq('actif', true).order('nom'),
      supabase.from('fabrications').select('*').order('date_fabrication', { ascending: false }).order('created_at', { ascending: false }).limit(40)
    ])
    return { articles: must(art), stock: stock.error ? [] : stock.data, couts: couts.error ? [] : couts.data, formules: must(formules), fabrications: must(fabs) }
  })
  const [fab, setFab] = useState({ formule: '', kg: '1000', sacs: '', date: localDate(), notes: '' })
  const [form, setForm] = useState({ nom: '', produit: '', sac: '', frais: '', notes: '' })
  const [lignes, setLignes] = useState([ligneVide(), ligneVide()])

  if (!q.data) return <Loading error={q.error} />
  const art = (id) => q.data.articles.find((a) => a.id === id)
  const stockDe = (id) => Number(q.data.stock.find((s) => s.article_id === id)?.stock ?? NaN)
  const coutDe = (id) => q.data.couts.find((c) => c.article_id === id)?.cout_unitaire_moyen
  const matieres = q.data.articles.filter((a) => a.categorie === 'matiere_premiere' && a.unite === 'kg')
  const emballages = q.data.articles.filter((a) => a.categorie === 'emballage')
  const produits = q.data.articles.filter((a) => a.categorie === 'aliment' && a.unite === 'sac' && Number(a.poids_unitaire_kg) > 0)
  // with a single formula, it is chosen already
  const formuleId = fab.formule || (q.data.formules.length === 1 ? q.data.formules[0].id : '')
  const formule = q.data.formules.find((f) => f.id === formuleId)
  const poidsSac = Number(art(formule?.article_id)?.poids_unitaire_kg) || 0
  const kg = Number(fab.kg) || 0
  const sacsPrevus = poidsSac ? Math.floor(kg / poidsSac) : 0
  const sacs = Number(fab.sacs) || sacsPrevus
  const besoins = (formule?.lignes ?? []).map((l) => {
    const besoin = Math.round(Number(l.quantite_kg) * kg / 10) / 100
    const cout = coutDe(l.article_id)
    return { ...l, nom: art(l.article_id)?.nom, besoin, stock: stockDe(l.article_id), cout: cout == null ? null : besoin * Number(cout) }
  })
  const coutMatieres = besoins.reduce((s, b) => s + (b.cout ?? 0), 0)
  const coutSac = formule?.article_sac_id ? sacs * Number(coutDe(formule.article_sac_id) ?? 0) : 0
  const frais = formule ? Math.round(Number(formule.frais_par_tonne) * kg / 1000) : 0
  const prixRevient = sacs > 0 ? Math.round((coutMatieres + coutSac + frais) / sacs) : 0
  const totalFormule = lignes.reduce((s, l) => s + (Number(l.quantite_kg) || 0), 0)
  const setL = (i, k) => (e) => setLignes(lignes.map((l, j) => (j === i ? { ...l, [k]: e.target.value } : l)))

  const fabriquer = async () => {
    must(await supabase.rpc('fabriquer', { p_formule: formuleId, p_quantite_kg: kg, p_sacs: sacs, p_date: fab.date, p_notes: fab.notes || null }))
    setFab({ ...fab, sacs: '', notes: '' }); q.reload()
    return t('provenderie.made', { n: n(sacs), nom: art(formule.article_id)?.nom })
  }
  const creerFormule = async () => {
    must(await supabase.rpc('creer_formule', { p_nom: form.nom, p_article: form.produit, p_article_sac: form.sac || null, p_frais_par_tonne: Number(form.frais) || 0,
      p_lignes: lignes.filter((l) => l.article_id).map((l) => ({ article_id: l.article_id, quantite_kg: Number(l.quantite_kg) })), p_notes: form.notes || null }))
    setForm({ nom: '', produit: '', sac: '', frais: '', notes: '' }); setLignes([ligneVide(), ligneVide()]); q.reload()
    return t('provenderie.formulaSaved')
  }
  const desactiver = async (f) => {
    if (await ask.confirm(t('provenderie.disableConfirm', { nom: f.nom }), { title: t('provenderie.disable'), icon: 'alert' })) await run(supabase.rpc('desactiver_formule', { p_formule: f.id }), q.reload)
  }
  const annuler = async (fb) => {
    const motif = await ask.reason(t('provenderie.cancelTitle'))
    if (motif) await run(supabase.rpc('annuler_fabrication', { p_fabrication: fb.id, p_motif: motif }), q.reload)
  }

  return (
    <div className="stack">
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'fabriquer', label: 'provenderie.tabs.make', icon: 'box' },
        { id: 'formules', label: 'provenderie.tabs.formulas', icon: 'note' },
        { id: 'historique', label: 'provenderie.tabs.history', icon: 'clock' }
      ]} />

      {tab === 'fabriquer' && (
        q.data.formules.length === 0 ? <Panel icon="box" tone="green" title={t('provenderie.title')}><Empty icon="note" text={t('provenderie.noFormula')} /></Panel> : (
          <>
            {can(role, 'provenderie.fabriquer') && (
              <FormCard title={t('provenderie.newProduction')} icon="box" onSubmit={fabriquer} startOpen>
                <div className="grid-2">
                  <Field label={t('provenderie.formula')}>
                    <select required value={formuleId} onChange={(e) => setFab({ ...fab, formule: e.target.value, sacs: '' })}>
                      <option value="">—</option>{q.data.formules.map((f) => <option key={f.id} value={f.id}>{f.nom}</option>)}
                    </select>
                  </Field>
                  <Field label={t('provenderie.kgToMake')}><input type="number" inputMode="decimal" min="1" required value={fab.kg} onChange={(e) => setFab({ ...fab, kg: e.target.value, sacs: '' })} /></Field>
                  <Field label={poidsSac ? t('provenderie.bagsObtained', { kg: n(poidsSac, 1) }) : t('provenderie.bagsObtainedShort')}>
                    <input type="number" inputMode="numeric" min="1" required value={fab.sacs || (sacsPrevus || '')} onChange={(e) => setFab({ ...fab, sacs: e.target.value })} />
                  </Field>
                  <Field label={t('saisie.date')}><input type="date" required value={fab.date} onChange={(e) => setFab({ ...fab, date: e.target.value })} /></Field>
                </div>
                {formule && (
                  <div className="table-wrap">
                    <table className="table">
                      <thead><tr><th>{t('provenderie.material')}</th><th className="num">{t('provenderie.needed')}</th><th className="num">{t('provenderie.inStock')}</th><th className="num">{t('provenderie.cost')}</th></tr></thead>
                      <tbody>
                        {besoins.map((b) => (
                          <tr key={b.article_id}>
                            <td>{b.nom}</td>
                            <td className="num">{n(b.besoin, 2)} kg</td>
                            <td className={`num ${b.stock < b.besoin ? 'warn-text' : ''}`}>{Number.isNaN(b.stock) ? '—' : `${n(b.stock, 2)} kg`}</td>
                            <td className="num">{b.cout == null ? <span className="warn-text">{t('provenderie.noPrice')}</span> : money(Math.round(b.cout), lang)}</td>
                          </tr>
                        ))}
                        {formule.article_sac_id && <tr><td>{art(formule.article_sac_id)?.nom}</td><td className="num">{n(sacs)}</td><td className="num">{Number.isNaN(stockDe(formule.article_sac_id)) ? '—' : n(stockDe(formule.article_sac_id))}</td><td className="num">{money(Math.round(coutSac), lang)}</td></tr>}
                        {frais > 0 && <tr><td>{t('provenderie.runningCosts')}</td><td /><td /><td className="num">{money(frais, lang)}</td></tr>}
                      </tbody>
                    </table>
                  </div>
                )}
                {formule && <div className="total-box"><span>{t('provenderie.costPerBag')}</span><strong>{money(prixRevient, lang)}</strong></div>}
              </FormCard>
            )}
            <p className="note"><Icon name="box" size={16} />{t('provenderie.howTo')} <Link to="/stock">{t('negoce.manageStock')}</Link></p>
          </>
        )
      )}

      {tab === 'formules' && (
        <>
          <Panel icon="note" tone="green" title={t('provenderie.formulasTitle')} subtitle={t('provenderie.formulasHint')}>
            {q.data.formules.length === 0 ? <Empty icon="note" text={t('provenderie.noFormula')} /> : (
              <ul className="list">
                {q.data.formules.map((f) => {
                  const total = f.lignes.reduce((s, l) => s + Number(l.quantite_kg), 0)
                  return (
                    <li key={f.id}>
                      <div className="grow">
                        <strong>{f.nom}</strong> → {art(f.article_id)?.nom}
                        <div className="muted small">{f.lignes.map((l) => `${art(l.article_id)?.nom} ${n(l.quantite_kg, 2)} kg`).join(' · ')}</div>
                        <div className="muted small">{[t('provenderie.totalKg', { n: n(total, 2) }), f.article_sac_id && art(f.article_sac_id)?.nom,
                          Number(f.frais_par_tonne) > 0 && t('provenderie.costsPerTonne', { n: money(f.frais_par_tonne, lang) })].filter(Boolean).join(' · ')}</div>
                        {can(role, 'provenderie.formule') && <div className="row-actions"><button className="btn ghost sm" onClick={() => desactiver(f)}>{t('provenderie.disable')}</button></div>}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Panel>
          {can(role, 'provenderie.formule') && (
            <FormCard title={t('provenderie.newFormula')} icon="plus" onSubmit={creerFormule}>
              <div className="grid-2">
                <Field label={t('provenderie.formulaName')}><input required value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} placeholder={t('provenderie.formulaNamePh')} /></Field>
                <Field label={t('provenderie.product')}>
                  <select required value={form.produit} onChange={(e) => setForm({ ...form, produit: e.target.value })}>
                    <option value="">—</option>{produits.map((a) => <option key={a.id} value={a.id}>{a.nom} ({n(a.poids_unitaire_kg, 1)} kg)</option>)}
                  </select>
                </Field>
                <Field label={t('provenderie.emptyBag')}>
                  <select value={form.sac} onChange={(e) => setForm({ ...form, sac: e.target.value })}>
                    <option value="">—</option>{emballages.map((a) => <option key={a.id} value={a.id}>{a.nom}</option>)}
                  </select>
                </Field>
                <Field label={t('provenderie.runningCostsPerTonne')}><input type="number" inputMode="numeric" min="0" value={form.frais} onChange={(e) => setForm({ ...form, frais: e.target.value })} /></Field>
              </div>
              <p className="muted small">{t('provenderie.linesHint')}</p>
              {lignes.map((l, i) => (
                <div key={i} className="vente-ligne formule-ligne">
                  <Field label={i === 0 ? t('provenderie.material') : ''}>
                    <select required={i === 0} value={l.article_id} onChange={setL(i, 'article_id')}>
                      <option value="">—</option>{matieres.map((a) => <option key={a.id} value={a.id}>{a.nom}</option>)}
                    </select>
                  </Field>
                  <Field label={i === 0 ? t('provenderie.kgPerTonne') : ''}><input type="number" inputMode="decimal" min="0.01" step="0.01" required={!!l.article_id} value={l.quantite_kg} onChange={setL(i, 'quantite_kg')} /></Field>
                  {lignes.length > 1 ? <button type="button" className="icon-btn dark" onClick={() => setLignes(lignes.filter((_, j) => j !== i))} aria-label={t('stock.remove')}><Icon name="trash" size={16} /></button> : <span />}
                </div>
              ))}
              <button type="button" className="btn ghost sm" onClick={() => setLignes([...lignes, ligneVide()])}><Icon name="plus" size={14} />{t('provenderie.addMaterial')}</button>
              <p className={totalFormule === 1000 ? 'muted small' : 'warn-text small'}>{t('provenderie.formulaTotal', { n: n(totalFormule, 2) })}</p>
              {(matieres.length === 0 || produits.length === 0) && <p className="note"><Icon name="box" size={16} />{t('provenderie.createItems')} <Link to="/stock">{t('negoce.manageStock')}</Link></p>}
            </FormCard>
          )}
        </>
      )}

      {tab === 'historique' && (
        <Panel icon="clock" tone="sky" title={t('provenderie.tabs.history')}>
          {q.data.fabrications.length === 0 ? <Empty icon="clock" text={t('provenderie.noProduction')} /> : (
            <ul className="list">
              {q.data.fabrications.map((fb) => {
                const f = q.data.formules.find((x) => x.id === fb.formule_id)
                return (
                  <li key={fb.id} className={fb.annulee ? 'cancelled' : ''}>
                    <div className="grow">
                      <strong>{day(fb.date_fabrication, lang)}</strong> · {f?.nom ?? t('provenderie.oldFormula')} · {n(fb.quantite_kg, 2)} kg → {n(fb.sacs_obtenus)} {t('provenderie.bags')}
                      <div className="muted small">
                        {[t('provenderie.detail', { m: money(fb.cout_matieres, lang), s: money(fb.cout_sacs, lang), f: money(fb.cout_frais, lang) }),
                          fb.cout_incomplet && t('provenderie.incomplete'), fb.annulee && `${t('provenderie.cancelled')} : ${fb.motif_annulation}`].filter(Boolean).join(' · ')}
                      </div>
                      {!fb.annulee && can(role, 'provenderie.annuler') && <div className="row-actions"><button className="btn ghost sm" onClick={() => annuler(fb)}>{t('provenderie.cancel')}</button></div>}
                    </div>
                    <span className="tag">{t('provenderie.perBag', { n: money(fb.prix_revient_sac, lang) })}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      )}
    </div>
  )
}
