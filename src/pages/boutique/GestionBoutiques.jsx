import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { must, useQuery } from '../../hooks'
import { can } from '../../config'
import Icon from '../../components/Icon'
import { day, Field, FormCard, Loading, money, Panel } from '../../components/ui'
import { useAsk, useRun } from '../../components/Dialog'

// Shop prices (same in every shop, the seller never changes them) and the list of shops (director)
const GRILLE = [
  ['poulet', 'vivant', 'piece'], ['poulet', 'vivant', 'kg'], ['poulet', 'abattu', 'piece'], ['poulet', 'abattu', 'kg'],
  ['poulet', 'decoupe', 'piece'], ['poulet', 'decoupe', 'kg'], ['oeufs', '-', 'piece'], ['oeufs', '-', 'plateau'],
  ['poule_reformee', 'vivant', 'piece'], ['poule_reformee', 'vivant', 'kg']
]

export default function GestionBoutiques({ onChange }) {
  const { t, i18n } = useTranslation()
  const { role } = useAuth()
  const lang = i18n.resolvedLanguage
  const ask = useAsk()
  const run = useRun()
  const q = useQuery(async () => {
    const [prix, boutiques] = await Promise.all([
      supabase.from('prix_boutique_actuels').select('*'),
      supabase.from('boutiques').select('*').order('nom')
    ])
    return { prix: must(prix), boutiques: must(boutiques) }
  })
  const [form, setForm] = useState({ nom: '', adresse: '', telephone: '' })

  const libelle = ([p, f, u]) => `${t(`boutique.produits.${p}`)}${f !== '-' ? ` ${t(`boutique.formes.${f}`).toLowerCase()}` : ''} — ${t('reglages.per', { unite: t(`unites.${u}`) })}`
  const prixActuel = ([p, f, u]) => q.data.prix.find((x) => x.produit === p && x.forme === f && x.unite === u)

  const changerPrix = async (g) => {
    const cur = prixActuel(g)
    const v = await ask.form({ title: libelle(g), icon: 'tag', submit: t('dialog.save'), message: t('boutique.priceHint'),
      fields: [{ name: 'prix', label: t('reglages.price'), type: 'number', min: 1, value: cur?.prix ?? '', required: true },
               { name: 'date', label: t('reglages.from'), type: 'date', value: new Date().toLocaleDateString('en-CA'), required: true }] })
    if (v) await run(supabase.from('prix_boutique').insert({ produit: g[0], forme: g[1], unite: g[2], prix: v.prix, date_debut: v.date }), q.reload)
  }
  const creer = async () => {
    must(await supabase.from('boutiques').insert({ nom: form.nom, adresse: form.adresse || null, telephone: form.telephone || null }))
    setForm({ nom: '', adresse: '', telephone: '' })
    q.reload(); onChange?.()
    return t('boutique.created')
  }
  const modifier = async (b) => {
    const v = await ask.form({ title: t('salaires.editTitle', { nom: b.nom }), icon: 'cart', submit: t('dialog.save'), fields: [
      { name: 'nom', label: t('reglages.name'), value: b.nom, required: true },
      { name: 'adresse', label: t('reglages.address'), value: b.adresse ?? '' },
      { name: 'telephone', label: t('reglages.phone'), type: 'tel', value: b.telephone ?? '' },
      { name: 'actif', label: t('stock.status'), type: 'select', value: b.actif ? 'oui' : 'non', options: [{ value: 'oui', label: t('boutique.open') }, { value: 'non', label: t('boutique.closed') }] }
    ] })
    if (v) await run(supabase.from('boutiques').update({ nom: v.nom, adresse: v.adresse || null, telephone: v.telephone || null, actif: v.actif === 'oui' }).eq('id', b.id), () => { q.reload(); onChange?.() })
  }

  if (!q.data) return <Loading error={q.error} />
  return (
    <>
      {can(role, 'boutique.prix') && (
        <Panel icon="tag" tone="yolk" title={t('boutique.pricesTitle')} subtitle={t('boutique.pricesHint')}>
          <ul className="list">
            {GRILLE.map((g) => {
              const cur = prixActuel(g)
              return (
                <li key={g.join('-')}>
                  <div className="grow"><strong>{libelle(g)}</strong>{cur && <div className="muted small">{t('reglages.since', { d: day(cur.date_debut, lang) })}</div>}</div>
                  {cur ? <strong>{money(cur.prix, lang)}</strong> : <span className="tag warn">{t('boutique.noPriceShort')}</span>}
                  <button className="btn ghost sm" onClick={() => changerPrix(g)}><Icon name="tag" size={14} /></button>
                </li>
              )
            })}
          </ul>
        </Panel>
      )}

      {can(role, 'boutique.admin') && (
        <>
          <Panel icon="cart" tone="green" title={t('boutique.shopsTitle')} subtitle={t('boutique.sellersHint')}>
            {q.data.boutiques.length === 0 ? <p className="muted">{t('boutique.noShop')}</p> : (
              <ul className="list">
                {q.data.boutiques.map((b) => (
                  <li key={b.id} className={b.actif ? '' : 'read'}>
                    <div className="grow"><strong>{b.nom}</strong><div className="muted small">{[b.adresse, b.telephone].filter(Boolean).join(' · ') || '—'}</div></div>
                    {!b.actif && <span className="tag muted">{t('boutique.closed')}</span>}
                    <button className="btn ghost sm" onClick={() => modifier(b)}>{t('common.edit')}</button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <FormCard title={t('boutique.newShop')} icon="cart" onSubmit={creer}>
            <div className="grid-2">
              <Field label={t('reglages.name')}><input required value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} placeholder={t('boutique.namePh')} /></Field>
              <Field label={t('reglages.address')}><input value={form.adresse} onChange={(e) => setForm({ ...form, adresse: e.target.value })} /></Field>
              <Field label={t('reglages.phone')}><input type="tel" value={form.telephone} onChange={(e) => setForm({ ...form, telephone: e.target.value })} /></Field>
            </div>
          </FormCard>
        </>
      )}
    </>
  )
}
