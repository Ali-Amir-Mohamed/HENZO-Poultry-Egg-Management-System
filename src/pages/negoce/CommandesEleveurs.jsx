import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { must, useQuery } from '../../hooks'
import { can, MODES_PAIEMENT } from '../../config'
import Icon from '../../components/Icon'
import { day, Empty, Field, FormCard, Loading, money, Panel, Tabs } from '../../components/ui'
import { useAsk, useRun } from '../../components/Dialog'
import { clientConnu, idClient } from '../../lib/clients'

// HENZO AGRO – chick orders from farmers, for a delivery date at a hatchery.
// Resale: HENZO AGRO buys and resells; deposits are deducted on delivery (the rest is paid or on credit) and the invoice is made.
// Commission: the hatchery sells to the farmer; HENZO AGRO earns a fixed amount per chick or a percentage, paid by the hatchery.
export default function CommandesEleveurs() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const { role } = useAuth()
  const ask = useAsk()
  const run = useRun()
  const [tab, setTab] = useState('en_cours')
  const n = (x) => Number(x ?? 0).toLocaleString(lang)
  const modes = MODES_PAIEMENT.map((m) => ({ value: m, label: t(`modes.${m}`) }))
  const q = useQuery(async () => {
    const [cmd, tiers, articles, comm] = await Promise.all([
      supabase.from('commandes_eleveurs_situation').select('*').order('date_livraison').order('created_at'),
      supabase.from('tiers').select('id, nom, type_tiers, credit_autorise').order('nom'),
      supabase.from('stock_articles').select('article_id, nom, stock').eq('categorie', 'poussins').eq('actif', true).order('nom'),
      supabase.from('commissions_couvoirs').select('*').order('nom')
    ])
    return { commandes: must(cmd), tiers: must(tiers), articles: must(articles), commissions: must(comm) }
  })
  const vide = { client: '', telephone: '', couvoir: '', type: 'revente', article: '', souche: '', quantite: '', date: '', prix: '', commMode: 'fixe', commValeur: '', notes: '' }
  const [form, setForm] = useState(vide)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  if (!q.data) return <Loading error={q.error} />
  const clients = q.data.tiers.filter((x) => x.type_tiers !== 'fournisseur')
  const couvoirs = q.data.tiers.filter((x) => x.type_tiers !== 'client')
  const enCours = q.data.commandes.filter((c) => c.statut === 'en_cours')
  const historique = q.data.commandes.filter((c) => c.statut !== 'en_cours').reverse()
  const parDate = enCours.reduce((m, c) => ({ ...m, [c.date_livraison]: [...(m[c.date_livraison] ?? []), c] }), {})

  const nouveauClient = !!form.client.trim() && !clientConnu(form.client, clients)
  const creer = async () => {
    const clientId = await idClient(form.client, form.telephone, clients)   // a new farmer is registered on the spot
    must(await supabase.rpc('creer_commande_eleveur', {
      p_client: clientId, p_couvoir: form.couvoir || null, p_article: form.type === 'revente' ? form.article : null, p_souche: form.souche || null,
      p_quantite: Number(form.quantite), p_date: form.date, p_prix: Number(form.prix) || 0, p_type: form.type,
      p_commission_mode: form.type === 'commission' ? form.commMode : null, p_commission_valeur: form.type === 'commission' ? Number(form.commValeur) || 0 : 0,
      p_notes: form.notes || null
    }))
    setForm({ ...vide, date: form.date }); q.reload()
    return t('commandes.created')
  }

  const avance = async (c) => {
    const v = await ask.form({ title: t('commandes.depositTitle', { nom: c.client_nom }), icon: 'wallet', submit: t('commandes.depositSave'),
      message: t('commandes.depositHint', { total: money(c.montant_commande, lang), deja: money(c.avance_disponible, lang) }),
      fields: [
        { name: 'montant', label: t('demarrage.amount'), type: 'number', min: 1, required: true },
        { name: 'mode', label: t('saisie.paiement'), type: 'select', value: 'especes', options: modes }
      ] })
    if (v) await run(supabase.rpc('verser_avance_commande', { p_commande: c.id, p_montant: Number(v.montant), p_mode: v.mode }), q.reload)
  }

  const livrer = async (c) => {
    const revente = c.type_vente === 'revente'
    const v = await ask.form({ title: t('commandes.deliverTitle', { nom: c.client_nom }), icon: 'check', submit: t('commandes.deliverSave'),
      message: revente ? t('commandes.deliverHintResale', { avance: money(c.avance_disponible, lang) }) : t('commandes.deliverHintCommission', { couvoir: c.couvoir_nom }),
      fields: [
        { name: 'quantite', label: t('commandes.delivered'), type: 'number', min: 1, value: c.quantite, required: true },
        ...(revente ? [
          { name: 'paye', label: t('commandes.paidNow'), type: 'number', min: 0, value: 0 },
          { name: 'mode', label: t('saisie.paiement'), type: 'select', value: 'especes', options: modes, showIf: (x) => Number(x.paye) > 0 }
        ] : [])
      ] })
    if (!v) return
    if (revente) {
      const total = Math.round(Number(v.quantite) * Number(c.prix_unitaire))
      const avanceUtilisee = Math.min(Number(c.avance_disponible), total)
      const reste = total - avanceUtilisee - (Number(v.paye) || 0)
      if (!(await ask.confirm(t('commandes.deliverConfirm', { total: money(total, lang), avance: money(avanceUtilisee, lang), paye: money(Number(v.paye) || 0, lang), reste: money(Math.max(reste, 0), lang) }),
        { title: t('commandes.deliverTitle', { nom: c.client_nom }), icon: 'check', submit: t('commandes.deliverSave') }))) return
    }
    const id = await run(supabase.rpc('livrer_commande', { p_commande: c.id, p_quantite: Number(v.quantite), p_mode: v.mode || null, p_paye: Number(v.paye) || 0 }), q.reload)
    if (revente && id && typeof id === 'string') await ask.info(t('commandes.delivered_ok'), t('commandes.invoiceHint'))
  }

  const annuler = async (c) => {
    const aAvance = Number(c.avance_disponible) > 0
    const v = await ask.form({ title: t('commandes.cancelTitle', { nom: c.client_nom }), icon: 'alert', submit: t('commandes.cancelSave'),
      message: aAvance ? t('commandes.cancelHintDeposit', { n: money(c.avance_disponible, lang) }) : null,
      fields: [
        { name: 'motif', label: t('commandes.reason'), required: true },
        ...(aAvance ? [
          { name: 'avance', label: t('commandes.depositChoice'), type: 'select', value: can(role, 'commande.rembourser') ? 'rendre' : 'garder',
            options: [...(can(role, 'commande.rembourser') ? [{ value: 'rendre', label: t('commandes.refund') }] : []), { value: 'garder', label: t('commandes.keep') }] },
          { name: 'mode', label: t('saisie.paiement'), type: 'select', value: 'especes', options: modes, showIf: (x) => x.avance === 'rendre' }
        ] : [])
      ] })
    if (v) await run(supabase.rpc('annuler_commande', { p_commande: c.id, p_motif: v.motif, p_rembourser: v.avance === 'rendre', p_mode: v.mode || 'especes' }), q.reload)
  }

  const recevoirCommission = async (x) => {
    const v = await ask.form({ title: t('commandes.commissionTitle', { nom: x.nom }), icon: 'wallet', submit: t('dialog.save'),
      message: t('commandes.commissionHint', { n: money(Number(x.due) - Number(x.recue), lang) }),
      fields: [
        { name: 'montant', label: t('demarrage.amount'), type: 'number', min: 1, value: Math.max(0, Number(x.due) - Number(x.recue)), required: true },
        { name: 'mode', label: t('saisie.paiement'), type: 'select', value: 'banque', options: modes }
      ] })
    if (v) await run(supabase.rpc('recevoir_commission', { p_couvoir: x.couvoir_id, p_montant: Number(v.montant), p_mode: v.mode }), q.reload)
  }

  const ligne = (c, actions) => (
    <li key={c.id} className={c.statut === 'annulee' ? 'cancelled' : ''}>
      <div className="grow">
        <strong>{c.client_nom}</strong> · {n(c.quantite_livree ?? c.quantite)} {t('commandes.chicks')}{c.souche ? ` ${c.souche}` : ''}
        <div className="muted small">
          {[c.couvoir_nom, t(`commandes.type.${c.type_vente}`),
            c.type_vente === 'revente' ? `${money(c.prix_unitaire, lang)} / ${t('commandes.chick')}` : c.commission_mode === 'fixe' ? t('commandes.perChick', { n: money(c.commission_valeur, lang) }) : `${n(c.commission_valeur)} %`,
            c.type_vente === 'revente' && Number(c.avance_disponible) > 0 && t('commandes.depositShort', { n: money(c.avance_disponible, lang) }),
            c.statut === 'livree' && c.type_vente === 'commission' && t('commandes.commissionDue', { n: money(c.commission_montant, lang) }),
            c.statut === 'livree' && Number(c.reste_vente) > 0 && t('commandes.leftToPay', { n: money(c.reste_vente, lang) }),
            c.statut === 'annulee' && `${t('commandes.cancelled')} : ${c.motif_annulation}`].filter(Boolean).join(' · ')}
        </div>
        {actions}
      </div>
      {c.type_vente === 'revente' && <strong>{money(Math.round((c.quantite_livree ?? c.quantite) * c.prix_unitaire), lang)}</strong>}
    </li>
  )

  return (
    <div className="stack">
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'en_cours', label: 'commandes.tabs.open', icon: 'calendar' },
        { id: 'historique', label: 'commandes.tabs.history', icon: 'clock' },
        { id: 'commissions', label: 'commandes.tabs.commissions', icon: 'wallet' }
      ]} />

      {tab === 'en_cours' && (
        <>
          <Panel icon="calendar" tone="green" title={t('commandes.title')} subtitle={t('commandes.subtitle', { count: enCours.length })}>
            {enCours.length === 0 ? <Empty icon="calendar" text={t('commandes.none')} /> : Object.entries(parDate).map(([d, liste]) => (
              <div key={d} className="salaires-groupe">
                <div className="salaires-groupe-head"><strong>{day(d, lang)}</strong><span>{t('commandes.totalChicks', { n: n(liste.reduce((s, c) => s + c.quantite, 0)) })}</span></div>
                <ul className="list">
                  {liste.map((c) => ligne(c, (
                    <div className="row-actions">
                      {can(role, 'commande.creer') && c.type_vente === 'revente' && <button className="btn ghost sm" onClick={() => avance(c)}>{t('commandes.deposit')}</button>}
                      {can(role, 'commande.creer') && <button className="btn primary sm" onClick={() => livrer(c)}><Icon name="check" size={14} />{t('commandes.deliver')}</button>}
                      {can(role, 'commande.annuler') && <button className="btn ghost sm" onClick={() => annuler(c)}>{t('commandes.cancel')}</button>}
                    </div>
                  )))}
                </ul>
              </div>
            ))}
          </Panel>

          {can(role, 'commande.creer') && (
            <FormCard title={t('commandes.new')} icon="plus" onSubmit={creer}>
              <div className="grid-2">
                <Field label={t('recu.client')}>
                  <input required list="clients-commandes" value={form.client} onChange={set('client')} placeholder={t('commandes.clientPh')} autoComplete="off" />
                  <datalist id="clients-commandes">{clients.map((c) => <option key={c.id} value={c.nom} />)}</datalist>
                </Field>
                {nouveauClient && <Field label={t('negoce.newClientPhone')}><input type="tel" value={form.telephone} onChange={set('telephone')} /></Field>}
                <Field label={t('commandes.hatchery')}>
                  <select required={form.type === 'commission'} value={form.couvoir} onChange={set('couvoir')}>
                    <option value="">—</option>{couvoirs.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                  </select>
                </Field>
                <Field label={t('commandes.saleType')}>
                  <select value={form.type} onChange={set('type')}>
                    <option value="revente">{t('commandes.type.revente')}</option>
                    <option value="commission">{t('commandes.type.commission')}</option>
                  </select>
                </Field>
                {form.type === 'revente' ? (
                  <Field label={t('commandes.stockItem')}>
                    <select required value={form.article} onChange={set('article')}>
                      <option value="">—</option>{q.data.articles.map((a) => <option key={a.article_id} value={a.article_id}>{a.nom} ({n(a.stock)})</option>)}
                    </select>
                  </Field>
                ) : (
                  <Field label={t('commandes.commissionMode')}>
                    <select value={form.commMode} onChange={set('commMode')}>
                      <option value="fixe">{t('commandes.fixed')}</option>
                      <option value="pourcentage">{t('commandes.percent')}</option>
                    </select>
                  </Field>
                )}
                <Field label={t('commandes.strain')}><input value={form.souche} onChange={set('souche')} placeholder="Cobb 500, Ross 308…" /></Field>
                <Field label={t('commandes.quantity')}><input type="number" inputMode="numeric" min="1" required value={form.quantite} onChange={set('quantite')} /></Field>
                <Field label={t('commandes.deliveryDate')}><input type="date" required value={form.date} onChange={set('date')} /></Field>
                <Field label={t('commandes.price')}><input type="number" inputMode="numeric" min="0" required value={form.prix} onChange={set('prix')} /></Field>
                {form.type === 'commission' && (
                  <Field label={form.commMode === 'fixe' ? t('commandes.commissionPerChick') : t('commandes.commissionPercent')}>
                    <input type="number" inputMode="decimal" min="0" step="0.01" required value={form.commValeur} onChange={set('commValeur')} />
                  </Field>
                )}
              </div>
              <Field label={t('saisie.notes')}><input value={form.notes} onChange={set('notes')} /></Field>
              {nouveauClient && <p className="note"><Icon name="users" size={16} />{t('commandes.newClient', { nom: form.client.trim() })}</p>}
              {form.quantite && form.prix && <p className="muted small">{t('commandes.amount', { n: money(Number(form.quantite) * Number(form.prix), lang) })}</p>}
              {q.data.articles.length === 0 && form.type === 'revente' && <p className="note"><Icon name="box" size={16} />{t('commandes.noChickItem')} <Link to="/stock">{t('negoce.manageStock')}</Link></p>}
            </FormCard>
          )}
        </>
      )}

      {tab === 'historique' && (
        <Panel icon="clock" tone="sky" title={t('commandes.tabs.history')}>
          {historique.length === 0 ? <Empty icon="clock" text={t('commandes.noneHistory')} /> : <ul className="list">{historique.map((c) => ligne(c, c.vente_id && (
            <div className="row-actions"><Link to={`/recu/${c.vente_id}`} className="btn ghost sm"><Icon name="receipt" size={14} />{t('recu.open')}</Link></div>
          )))}</ul>}
        </Panel>
      )}

      {tab === 'commissions' && (
        <Panel icon="wallet" tone="yolk" title={t('commandes.commissionsTitle')} subtitle={t('commandes.commissionsHint')}>
          {q.data.commissions.length === 0 ? <Empty icon="wallet" text={t('commandes.noCommission')} /> : (
            <ul className="list">
              {q.data.commissions.map((x) => {
                const reste = Number(x.due) - Number(x.recue)
                return (
                  <li key={x.couvoir_id}>
                    <div className="grow">
                      <strong>{x.nom}</strong>
                      <div className="muted small">{t('commandes.commissionLine', { due: money(x.due, lang), recue: money(x.recue, lang) })}</div>
                      {can(role, 'commission.recevoir') && reste > 0 && <div className="row-actions"><button className="btn primary sm" onClick={() => recevoirCommission(x)}><Icon name="wallet" size={14} />{t('commandes.commissionReceived')}</button></div>}
                    </div>
                    <span className={`tag ${reste > 0 ? 'warn' : 'ok'}`}>{reste > 0 ? t('commandes.leftToReceive', { n: money(reste, lang) }) : t('commandes.allReceived')}</span>
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
