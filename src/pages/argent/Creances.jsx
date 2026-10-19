import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { must, useQuery } from '../../hooks'
import { can, TABLES } from '../../config'
import Icon from '../../components/Icon'
import { day, Loading, money, Panel } from '../../components/ui'
import { useAsk, useRun } from '../../components/Dialog'
import { envoyerWhatsApp } from '../../lib/whatsapp'
import NoteConfiance from '../../components/NoteConfiance'

// Clients' debts, by client: how much, since when, the unpaid sales (each one can be cashed), and a WhatsApp reminder
// written in advance; every reminder is noted. Group companies pay through their own deliveries: no reminder for them.
export default function Creances() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const { role, profile } = useAuth()
  const ask = useAsk()
  const run = useRun()
  const [ouvert, setOuvert] = useState(null)
  const q = useQuery(async () => {
    const [clients, ventes, notes] = await Promise.all([
      supabase.from('creances_par_client').select('*').order('reste', { ascending: false }),
      supabase.from('creances_clients').select('*').order('date_vente'),
      supabase.from('confiance_clients').select('client_id, note')
    ])
    return { clients: must(clients), ventes: must(ventes), notes: Object.fromEntries((notes.data ?? []).map((n) => [n.client_id, n.note])) }
  })

  if (!q.data) return <Panel icon="users" tone="sky" title={t('argent.receivables')}><Loading error={q.error} /></Panel>
  const total = q.data.clients.reduce((s, c) => s + Number(c.reste), 0)
  const anciens = q.data.clients.filter((c) => Number(c.jours) > 30).reduce((s, c) => s + Number(c.reste), 0)
  const ventesDe = (c) => q.data.ventes.filter((v) => v.client_id === c.client_id)

  const encaisser = async (v) => {
    const r = await ask.payment(t('argent.collectFrom', { nom: v.client }), {
      value: Number(v.reste), max: Number(v.reste), withDate: true, hint: t('argent.remaining', { n: money(v.reste, lang) }), submit: t('dialog.save')
    })
    if (r) await run(supabase.from(TABLES.paiementsClients).insert({ vente_id: v.vente_id, montant: r.montant, mode_paiement: r.mode, date_paiement: r.date }), q.reload)
  }

  const relancer = async (c) => {
    const lignes = ventesDe(c).map((v) => `• ${day(v.date_vente, lang)} : ${money(v.reste, lang)}`)
    const texte = t('relances.message', { nom: c.client, total: money(c.reste, lang), lignes: lignes.join('\n'), societe: profile?.ferme?.nom ?? '' })
    if (!(await envoyerWhatsApp(ask, t, { telephone: c.telephone, texte }))) return   // closed without sending: nothing noted
    await run(supabase.rpc('noter_relance', { p_client: c.client_id, p_montant: Number(c.reste) }), q.reload)
  }

  return (
    <Panel icon="users" tone="sky" title={t('argent.receivables')}
      subtitle={q.data.clients.length ? t('relances.summary', { total: money(total, lang), anciens: money(anciens, lang) }) : null}>
      {q.data.clients.length === 0 ? <p className="muted">{t('argent.no_creances')}</p> : (
        <ul className="list">
          {q.data.clients.map((c) => (
            <li key={c.client_id} className="creance-client">
              <div className="grow">
                <strong>{c.client}</strong>{c.societe_groupe && <span className="muted"> · {t('negoce.group')}</span>} <NoteConfiance note={q.data.notes[c.client_id]} />
                <div className="muted small">
                  {[t('relances.sales', { count: Number(c.ventes) }), t('relances.since', { count: Number(c.jours), d: day(c.plus_ancienne, lang) }),
                    c.telephone, c.derniere_relance ? t('relances.last', { d: day(c.derniere_relance, lang), count: Number(c.relances) }) : t('relances.never')]
                    .filter(Boolean).join(' · ')}
                </div>
                <div className="row-actions">
                  {!c.societe_groupe && can(role, 'creances.relancer') && <button className="btn primary sm" onClick={() => relancer(c)}><Icon name="bell" size={14} />{t('relances.remind')}</button>}
                  <button className="btn ghost sm" onClick={() => setOuvert(ouvert === c.client_id ? null : c.client_id)}>{t(ouvert === c.client_id ? 'relances.hide' : 'relances.detail')}</button>
                </div>
                {ouvert === c.client_id && (
                  <ul className="list sub">
                    {ventesDe(c).map((v) => (
                      <li key={v.vente_id}>
                        <div className="grow">
                          {day(v.date_vente, lang)} · {t(`produits.${v.produit}`, { defaultValue: v.produit })} · {t('argent.of', { n: money(v.montant, lang) })}
                          {v.date_echeance ? ` · ${t('argent.due', { d: day(v.date_echeance, lang) })}` : ''}
                        </div>
                        <strong>{money(v.reste, lang)}</strong>
                        {can(role, 'paiement') && !c.societe_groupe && <button className="btn ghost sm" onClick={() => encaisser(v)}>{t('argent.collect')}</button>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="right">
                <strong>{money(c.reste, lang)}</strong>
                {Number(c.jours) > 30 && <span className="tag danger">{t('relances.old', { count: Number(c.jours) })}</span>}
                {Number(c.jours) <= 30 && c.en_retard && <span className="tag danger">{t('argent.late')}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
