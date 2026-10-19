import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useQuery } from '../hooks'
import Icon, { Logo } from '../components/Icon'
import { day, Loading, money } from '../components/ui'
import { useAsk } from '../components/Dialog'
import { envoyerImageWhatsApp } from '../lib/whatsapp'

// The group's monthly report, for the partners and the investors: every company side by side (sales, result,
// money, debts), then each company in detail. Printable on A4 and shareable on WhatsApp as a picture.
// The detailed report of a single farm stays in Analyses > Report.
const moisPrecedent = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toLocaleDateString('en-CA').slice(0, 7) }

export default function RapportGroupe() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const ask = useAsk()
  const docRef = useRef(null)
  const [mois, setMois] = useState(moisPrecedent)
  const q = useQuery(async () => {
    const { data, error } = await supabase.rpc('rapport_mois', { p_mois: `${mois}-01` })
    if (error) throw error
    return data
  }, [mois])
  const n = (v) => Number(v ?? 0).toLocaleString(lang)
  const titreMois = new Date(`${mois}-01T00:00`).toLocaleDateString(lang, { month: 'long', year: 'numeric' })
  const evol = (s) => (Number(s.ventes_prec) ? Math.round(((Number(s.ventes) - Number(s.ventes_prec)) / Number(s.ventes_prec)) * 100) : null)
  const r = q.data
  const total = (k) => (r?.societes ?? []).reduce((s, c) => s + Number(c[k] ?? 0), 0)

  const partager = () => envoyerImageWhatsApp(ask, t, {
    element: docRef.current, nom: `rapport-${mois}`, telephone: null,
    texte: t('rapportG.shareText', { mois: titreMois, ventes: money(total('ventes'), lang), resultat: money(total('resultat'), lang) }),
    legende: t('rapportG.title', { mois: titreMois })
  })

  return (
    <div className="stack">
      <style>{'@page { size: A4 portrait; margin: 12mm; }'}</style>{/* printed on A4 while the report is open */}
      <div className="row no-print">
        <label className="field"><span>{t('analyses.month')}</span><input type="month" value={mois} onChange={(e) => setMois(e.target.value)} /></label>
        <span className="spacer" />
        <button className="btn primary" onClick={() => window.print()} disabled={!r}><Icon name="download" size={16} />{t('capital.print')}</button>
        <button className="btn ghost" onClick={partager} disabled={!r}><Icon name="users" size={16} />{t('recu.whatsapp')}</button>
      </div>

      {!r ? <Loading error={q.error} /> : (
        <article ref={docRef} className="rapport-groupe">
          <header className="rg-head">
            <Logo size={44} />
            <div>
              <h1>{t('rapportG.title', { mois: titreMois })}</h1>
              <p className="muted">{day(r.debut, lang)} – {day(r.fin, lang)} · {t('rapportG.made', { d: day(new Date().toLocaleDateString('en-CA'), lang) })}</p>
            </div>
          </header>

          <section>
            <h2>{t('rapportG.overview')}</h2>
            <table className="table rg-table">
              <thead><tr><th /><th className="num">{t('rapportG.sales')}</th><th className="num">{t('rapportG.result')}</th><th className="num">{t('rapportG.money')}</th><th className="num">{t('rapportG.toCollect')}</th><th className="num">{t('rapportG.toPay')}</th></tr></thead>
              <tbody>
                {r.societes.map((s) => (
                  <tr key={s.id}>
                    <td><strong>{s.nom}</strong><div className="muted small">{t(s.type === 'negoce' ? 'systeme.negoce' : 'systeme.elevage')}</div></td>
                    <td className="num">{money(s.ventes, lang)}{evol(s) != null && <div className={`small ${evol(s) < 0 ? 'error' : 'success'}`}>{evol(s) > 0 ? '+' : ''}{evol(s)} %</div>}</td>
                    <td className={`num ${Number(s.resultat) < 0 ? 'error' : ''}`}><strong>{money(s.resultat, lang)}</strong></td>
                    <td className="num">{money(s.argent_fin, lang)}</td>
                    <td className="num">{money(s.a_recevoir_fin, lang)}</td>
                    <td className="num">{money(s.a_payer_fin, lang)}</td>
                  </tr>
                ))}
                {r.societes.length > 1 && (
                  <tr className="sum">
                    <td>{t('rapportG.total')}</td>
                    <td className="num">{money(total('ventes'), lang)}</td>
                    <td className="num"><strong>{money(total('resultat'), lang)}</strong></td>
                    <td className="num">{money(total('argent_fin'), lang)}</td>
                    <td className="num">{money(total('a_recevoir_fin'), lang)}</td>
                    <td className="num">{money(total('a_payer_fin'), lang)}</td>
                  </tr>
                )}
              </tbody>
            </table>
            <p className="muted small">{t('rapportG.overviewNote')}</p>
          </section>

          {r.societes.map((s) => (
            <section key={s.id} className="rg-societe">
              <h2>{s.nom}{s.sites?.length > 1 ? <span className="muted"> · {s.sites.join(', ')}</span> : null}</h2>
              <div className="rg-grid">
                <div>
                  <h3>{t('rapportG.resultTitle')}</h3>
                  <div className="benef-calcul">
                    <div className="benef-ligne"><span>{t('rapportG.sales')}</span><strong>{money(s.ventes, lang)}</strong></div>
                    {s.type === 'negoce' && <div className="benef-ligne"><span>− {t('benefices.purchaseCost')}</span><strong>{money(s.cout, lang)}</strong></div>}
                    {Number(s.commissions) > 0 && <div className="benef-ligne"><span>+ {t('benefices.commissions')}</span><strong>{money(s.commissions, lang)}</strong></div>}
                    <div className="benef-ligne"><span>− {t('rapportG.charges')}</span><strong>{money(s.charges, lang)}</strong></div>
                    <div className="benef-ligne fort"><span>= {t('rapportG.result')}</span><strong>{money(s.resultat, lang)}</strong></div>
                  </div>
                  {s.charges_detail.length > 0 && (
                    <>
                      <h3>{t('rapportG.chargesTitle')}</h3>
                      <ul className="rg-liste">{s.charges_detail.map((c) => <li key={c.categorie}><span>{t(`categories.${c.categorie}`, { defaultValue: c.categorie })}</span><strong>{money(c.montant, lang)}</strong></li>)}</ul>
                    </>
                  )}
                </div>
                <div>
                  {s.type === 'elevage' && (
                    <>
                      <h3>{t('rapportG.production')}</h3>
                      <ul className="rg-liste">
                        <li><span>{t('rapportG.birdsSold')}</span><strong>{n(s.poulets_vendus)}</strong></li>
                        <li><span>{t('rapportG.eggs')}</span><strong>{n(s.oeufs)}</strong></li>
                        <li><span>{t('rapportG.deaths')}</span><strong>{n(s.mortalite)}</strong></li>
                        <li><span>{t('rapportG.flocksClosed')}</span><strong>{n(s.bandes_cloturees)}</strong></li>
                      </ul>
                    </>
                  )}
                  {s.top_produits.length > 0 && (<><h3>{t('rapportG.topProducts')}</h3><ul className="rg-liste">{s.top_produits.map((p) => <li key={p.nom}><span>{t(`produits.${p.nom}`, { defaultValue: p.nom })}</span><strong>{money(p.montant, lang)}</strong></li>)}</ul></>)}
                  {s.top_clients.length > 0 && (<><h3>{t('rapportG.topClients')}</h3><ul className="rg-liste">{s.top_clients.map((c) => <li key={c.nom}><span>{c.nom}</span><strong>{money(c.montant, lang)}</strong></li>)}</ul></>)}
                  {Number(s.nouveaux_clients) > 0 && <p className="muted small">{t('rapportG.newClients', { count: Number(s.nouveaux_clients) })}</p>}
                </div>
              </div>
            </section>
          ))}
          <footer className="muted small">{t('rapportG.footer')}</footer>
        </article>
      )}
      <p className="muted small no-print">{t('rapportG.farmDetail')} <Link to="/analyses">{t('nav.analyses')}</Link></p>
    </div>
  )
}
