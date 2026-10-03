import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { must, useQuery } from '../hooks'
import { can, TABLES } from '../config'
import { localDate } from '../lib/stats'
import Icon from '../components/Icon'
import { day, Empty, Field, FormCard, Loading, Tabs } from '../components/ui'

// Broiler flocks and layer lots: list, creation, closure workflow
export default function Ferme() {
  const [tab, setTab] = useState('chair')
  return (
    <div className="stack">
      <Tabs value={tab} onChange={setTab}
        tabs={[{ id: 'chair', label: 'types.chair_pl', icon: 'drumstick' }, { id: 'pondeuse', label: 'types.pondeuse_pl', icon: 'egg' }]} />
      {tab === 'chair' ? <Bandes /> : <Lots />}
    </div>
  )
}

function useFournisseurs() {
  return useQuery(async () => must(await supabase.from(TABLES.tiers).select('id, nom')
    .in('type_tiers', ['fournisseur', 'client_fournisseur']).order('nom')))
}

// ---------- Broilers ----------
function Bandes() {
  const { t, i18n } = useTranslation()
  const { role } = useAuth()
  const lang = i18n.resolvedLanguage
  const list = useQuery(async () => must(await supabase.from('effectif_bandes').select('*').order('date_arrivee', { ascending: false })))
  const fournisseurs = useFournisseurs()
  const [form, setForm] = useState({ code: '', date_arrivee: localDate(), nombre_initial: '', age_arrivee_jours: '1', souche: '', fournisseur_id: '', date_vente_prevue: '', notes: '' })
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const create = async () => {
    must(await supabase.from(TABLES.bandes).insert({
      ...form,
      nombre_initial: Number(form.nombre_initial),
      age_arrivee_jours: Number(form.age_arrivee_jours),
      fournisseur_id: form.fournisseur_id || null,
      date_vente_prevue: form.date_vente_prevue || null,
      souche: form.souche || null,
      notes: form.notes || null
    }))
    list.reload()
    return t('ferme.created', { code: form.code })
  }

  const changeStatut = async (b, statut, question) => {
    if (!window.confirm(question)) return
    const { error } = await supabase.from(TABLES.bandes).update({ statut }).eq('id', b.bande_id)
    if (error) window.alert(error.message)
    list.reload()
  }

  return (
    <>
      {can(role, 'bande.create') && (
        <FormCard title={t('ferme.newBande')} onSubmit={create}>
          <div className="grid-2">
            <Field label={t('ferme.code')}><input required value={form.code} onChange={set('code')} placeholder="ex. C-2026-10" /></Field>
            <Field label={t('ferme.arrival')}><input type="date" required value={form.date_arrivee} onChange={set('date_arrivee')} /></Field>
            <Field label={t('ferme.initial')}><input type="number" min="1" required value={form.nombre_initial} onChange={set('nombre_initial')} /></Field>
            <Field label={t('ferme.ageDays')}><input type="number" min="0" required value={form.age_arrivee_jours} onChange={set('age_arrivee_jours')} /></Field>
            <Field label={t('ferme.strain')}><input value={form.souche} onChange={set('souche')} placeholder="ex. Cobb 500" /></Field>
            <Field label={t('ferme.supplier')}>
              <select value={form.fournisseur_id} onChange={set('fournisseur_id')}>
                <option value="">—</option>
                {(fournisseurs.data ?? []).map((f) => <option key={f.id} value={f.id}>{f.nom}</option>)}
              </select>
            </Field>
            <Field label={t('ferme.plannedSale')}><input type="date" value={form.date_vente_prevue} onChange={set('date_vente_prevue')} /></Field>
          </div>
          <Field label={t('saisie.notes')}><textarea rows="2" value={form.notes} onChange={set('notes')} /></Field>
        </FormCard>
      )}

      {!list.data ? <Loading error={list.error} /> : list.data.length === 0 ? <Empty icon="drumstick" text={t('ferme.noBande')} /> : (
        <div className="cards">
          {list.data.map((b) => (
            <article key={b.bande_id} className="card-item">
              <header>
                <strong>{b.code}</strong>
                <span className={`tag ${b.statut === 'en_cours' ? 'ok' : b.statut === 'cloturee' ? 'muted' : 'warn'}`}>{t(`statuts.${b.statut}`)}</span>
              </header>
              <div className="facts">
                <Fact label={t('dashboard.age')} value={t('dashboard.days', { n: b.age_jours })} />
                <Fact label={t('ferme.remaining')} value={`${b.restants} / ${b.nombre_initial}`} />
                <Fact label={t('ferme.dead')} value={`${b.morts} (${((b.morts / b.nombre_initial) * 100).toFixed(1)} %)`} />
                <Fact label={t('ferme.sold')} value={b.vendus} />
                <Fact label={t('ferme.arrival')} value={day(b.date_arrivee, lang)} />
                <Fact label={t('ferme.plannedSale')} value={day(b.date_vente_prevue, lang)} />
              </div>
              <footer>
                {b.statut === 'en_cours' && can(role, 'bande.requestClose') && (
                  <button className="btn ghost" onClick={() => changeStatut(b, 'cloture_demandee', t('ferme.confirmRequest', { code: b.code }))}>
                    <Icon name="flag" size={16} />{t('ferme.requestClose')}
                  </button>
                )}
                {b.statut === 'cloture_demandee' && can(role, 'bande.validateClose') && (
                  <>
                    <button className="btn primary" onClick={() => changeStatut(b, 'cloturee', t('ferme.confirmClose', { code: b.code }))}>
                      <Icon name="check" size={16} />{t('ferme.validateClose')}
                    </button>
                    <button className="btn ghost" onClick={() => changeStatut(b, 'en_cours', t('ferme.confirmRefuse', { code: b.code }))}>
                      {t('ferme.refuseClose')}
                    </button>
                  </>
                )}
              </footer>
            </article>
          ))}
        </div>
      )}
    </>
  )
}

// ---------- Layers ----------
function Lots() {
  const { t, i18n } = useTranslation()
  const { role } = useAuth()
  const lang = i18n.resolvedLanguage
  const list = useQuery(async () => must(await supabase.from('effectif_lots').select('*').order('date_arrivee', { ascending: false })))
  const fournisseurs = useFournisseurs()
  const [form, setForm] = useState({ code: '', date_arrivee: localDate(), effectif_initial: '', age_arrivee_semaines: '18', souche: '', fournisseur_id: '', notes: '' })
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const create = async () => {
    must(await supabase.from(TABLES.lots).insert({
      ...form,
      effectif_initial: Number(form.effectif_initial),
      age_arrivee_semaines: Number(form.age_arrivee_semaines),
      fournisseur_id: form.fournisseur_id || null,
      souche: form.souche || null,
      notes: form.notes || null
    }))
    list.reload()
    return t('ferme.created', { code: form.code })
  }

  const reformer = async (l) => {
    if (!window.confirm(t('ferme.confirmReform', { code: l.code }))) return
    const { error } = await supabase.from(TABLES.lots).update({ statut: 'reforme', date_reforme: localDate() }).eq('id', l.lot_id)
    if (error) window.alert(error.message)
    list.reload()
  }

  return (
    <>
      {can(role, 'bande.create') && (
        <FormCard title={t('ferme.newLot')} onSubmit={create}>
          <div className="grid-2">
            <Field label={t('ferme.code')}><input required value={form.code} onChange={set('code')} placeholder="ex. P-2026-01" /></Field>
            <Field label={t('ferme.arrival')}><input type="date" required value={form.date_arrivee} onChange={set('date_arrivee')} /></Field>
            <Field label={t('ferme.initial')}><input type="number" min="1" required value={form.effectif_initial} onChange={set('effectif_initial')} /></Field>
            <Field label={t('ferme.ageWeeks')}><input type="number" min="0" required value={form.age_arrivee_semaines} onChange={set('age_arrivee_semaines')} /></Field>
            <Field label={t('ferme.strain')}><input value={form.souche} onChange={set('souche')} placeholder="ex. ISA Brown" /></Field>
            <Field label={t('ferme.supplier')}>
              <select value={form.fournisseur_id} onChange={set('fournisseur_id')}>
                <option value="">—</option>
                {(fournisseurs.data ?? []).map((f) => <option key={f.id} value={f.id}>{f.nom}</option>)}
              </select>
            </Field>
          </div>
          <Field label={t('saisie.notes')}><textarea rows="2" value={form.notes} onChange={set('notes')} /></Field>
        </FormCard>
      )}

      {!list.data ? <Loading error={list.error} /> : list.data.length === 0 ? <Empty icon="egg" text={t('ferme.noLot')} /> : (
        <div className="cards">
          {list.data.map((l) => (
            <article key={l.lot_id} className="card-item">
              <header>
                <strong>{l.code}</strong>
                <span className={`tag ${l.statut === 'en_production' ? 'ok' : 'muted'}`}>{t(`statuts.${l.statut}`)}</span>
              </header>
              <div className="facts">
                <Fact label={t('dashboard.age')} value={t('ferme.weeks', { n: l.age_semaines })} />
                <Fact label={t('dashboard.birds')} value={`${l.effectif} / ${l.effectif_initial}`} />
                <Fact label={t('ferme.dead')} value={l.morts} />
                <Fact label={t('ferme.reformed')} value={l.vendus} />
                <Fact label={t('ferme.arrival')} value={day(l.date_arrivee, lang)} />
              </div>
              {l.statut === 'en_production' && can(role, 'bande.create') && (
                <footer>
                  <button className="btn ghost" onClick={() => reformer(l)}>{t('ferme.reform')}</button>
                </footer>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  )
}

function Fact({ label, value }) {
  return <div className="fact"><span>{label}</span><strong>{value}</strong></div>
}
