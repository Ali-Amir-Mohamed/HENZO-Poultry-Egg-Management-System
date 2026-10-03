import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { enqueue } from '../lib/offlineQueue'
import { loadReference, prixDuMoment, readCachedReference } from '../lib/referenceData'
import { localDate } from '../lib/stats'
import { MODES_PAIEMENT, PRODUITS, TABLES } from '../config'
import Icon from '../components/Icon'

// Offline-first field entry. saisi_par / ferme_id are filled by the database defaults.
// Each form only lists the flocks it applies to (layers: lots, broilers: bandes).
const FORMS = {
  ponte: {
    table: TABLES.pontes, icon: 'egg', tone: 'yolk', cible: 'lot', dateField: 'date_ponte',
    fields: [
      { name: 'oeufs_collectes', big: true },
      { name: 'oeufs_casses', big: true, initial: '0' }
    ]
  },
  mortalite: {
    table: TABLES.mortalites, icon: 'alert', tone: 'rose', cible: 'tous', dateField: 'date_constat',
    fields: [
      { name: 'nombre', big: true, min: 1 },
      { name: 'cause', text: true, optional: true }
    ]
  },
  pesee: {
    table: TABLES.pesees, icon: 'scale', tone: 'green', cible: 'bande', dateField: 'date_pesee',
    fields: [
      { name: 'poids_moyen_g', big: true, min: 1, step: '0.1' },
      { name: 'nombre_peses', big: true, min: 1, initial: '10' }
    ]
  },
  aliment: {
    table: TABLES.mouvementsStock, icon: 'box', tone: 'sky', cible: 'tous', dateField: 'date_mouvement',
    fixed: { type_mouvement: 'sortie' }, article: true,
    fields: [{ name: 'quantite', big: true, min: 0.01, step: '0.01' }]
  },
  vente: { icon: 'cart', tone: 'green' },
  observation: {
    table: TABLES.observations, icon: 'note', tone: 'sky', cible: 'facultatif', dateField: 'date_observation',
    fields: [{ name: 'texte', textarea: true }], noNotes: true
  }
}

export default function Saisie() {
  const { t } = useTranslation()
  const [kind, setKind] = useState('ponte')
  const [ref, setRef] = useState(readCachedReference)

  useEffect(() => { loadReference().then(setRef) }, [])

  return (
    <div className="stack">
      <div className="segmented wrap" role="tablist">
        {Object.entries(FORMS).map(([k, f]) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k}
            className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>
            <Icon name={f.icon} size={18} />{t(`saisie.kinds.${k}`)}
          </button>
        ))}
      </div>
      {kind === 'vente'
        ? <VenteForm key="vente" refData={ref} />
        : <FieldForm key={kind} kind={kind} refData={ref} />}
    </div>
  )
}

// ---------- Generic field forms ----------
function emptyForm(def) {
  const form = { cible: '', [def.dateField]: localDate(), notes: '', article_id: '' }
  for (const f of def.fields) form[f.name] = f.initial ?? ''
  return form
}

function FieldForm({ kind, refData }) {
  const { t } = useTranslation()
  const def = FORMS[kind]
  const [form, setForm] = useState(() => emptyForm(def))
  const [saved, setSaved] = useState(false)
  const set = (key) => (e) => { setSaved(false); setForm({ ...form, [key]: e.target.value }) }

  const submit = async (e) => {
    e.preventDefault()
    const row = { [def.dateField]: form[def.dateField], ...def.fixed, ...cibleToIds(form.cible) }
    if (!def.noNotes) row.notes = form.notes || null
    if (def.article) row.article_id = form.article_id
    for (const f of def.fields) {
      row[f.name] = f.text || f.textarea ? (form[f.name] || null) : Number(form[f.name])
    }
    await enqueue(def.table, row)
    setForm({ ...emptyForm(def), cible: form.cible, article_id: form.article_id })
    setSaved(true)
  }

  return (
    <form className="panel form" onSubmit={submit}>
      <FormHead kind={kind} />
      <div className="grid-2">
        <label className="field">
          <span>{t('saisie.date')}</span>
          <input type="date" required value={form[def.dateField]} onChange={set(def.dateField)} />
        </label>
        <CibleSelect type={def.cible} refData={refData} value={form.cible} onChange={set('cible')} />
      </div>

      {def.article && (
        <label className="field">
          <span>{t('saisie.article')}</span>
          <select required value={form.article_id} onChange={set('article_id')}>
            <option value="" disabled>{refData.articles.length ? t('saisie.chooseArticle') : t('saisie.noArticle')}</option>
            {refData.articles.map((a) => <option key={a.id} value={a.id}>{a.nom} ({t(`unites.${a.unite}`)})</option>)}
          </select>
        </label>
      )}

      <div className="grid-2">
        {def.fields.map((f) => (
          <label key={f.name} className={`field ${f.big ? 'big' : ''} ${f.textarea ? 'span-2' : ''}`}>
            <span>{t(`saisie.fields.${f.name}`)}</span>
            {f.textarea ? (
              <textarea rows="4" required value={form[f.name]} onChange={set(f.name)} />
            ) : f.text ? (
              <input value={form[f.name]} onChange={set(f.name)} />
            ) : (
              <input type="number" inputMode="decimal" min={f.min ?? 0} step={f.step ?? '1'}
                required={!f.optional} placeholder="0" value={form[f.name]} onChange={set(f.name)} />
            )}
          </label>
        ))}
      </div>

      {!def.noNotes && (
        <label className="field">
          <span>{t('saisie.notes')}</span>
          <textarea rows="2" value={form.notes} onChange={set('notes')} />
        </label>
      )}
      <Submit saved={saved} />
    </form>
  )
}

// ---------- Sale form ----------
function VenteForm({ refData }) {
  const { t, i18n } = useTranslation()
  const initial = (activite) => {
    const prod = PRODUITS[activite][0]
    const first = activite === 'chair' ? refData.bandes[0] : refData.lots[0]
    return {
      activite,
      cible: first ? (activite === 'chair' ? `b:${first.bande_id}` : `l:${first.lot_id}`) : '',
      produit: prod.produit,
      unite: prod.unites[0],
      nombre_sujets: '',
      quantite: '',
      prix_unitaire: prixDuMoment(refData, prod.produit, prod.unites[0]),
      paiement: 'especes',
      client_id: '',
      acompte: '',
      mode_acompte: 'especes',
      date_echeance: '',
      date_vente: localDate(),
      notes: ''
    }
  }
  const [form, setForm] = useState(() => initial('chair'))
  const [saved, setSaved] = useState(false)

  // The flock list may arrive after the first render (fresh data from the server)
  useEffect(() => {
    if (!form.cible) setForm((f) => ({ ...f, cible: initial(f.activite).cible }))
  }, [refData]) // eslint-disable-line react-hooks/exhaustive-deps

  const produitDef = PRODUITS[form.activite].find((p) => p.produit === form.produit)
  const quantiteEgaleSujets = produitDef.sujets && form.unite === 'piece'
  const quantite = quantiteEgaleSujets ? Number(form.nombre_sujets) : Number(form.quantite)
  const total = Math.round((quantite || 0) * (Number(form.prix_unitaire) || 0))
  const credit = form.paiement === 'credit'
  const clients = credit ? refData.clients.filter((c) => c.credit_autorise) : refData.clients
  const fmt = (n) => Number(n || 0).toLocaleString(i18n.resolvedLanguage)

  const update = (patch) => { setSaved(false); setForm((f) => ({ ...f, ...patch })) }
  const set = (key) => (e) => update({ [key]: e.target.value })
  const setProduit = (produit) => {
    const def = PRODUITS[form.activite].find((p) => p.produit === produit)
    update({ produit, unite: def.unites[0], prix_unitaire: prixDuMoment(refData, produit, def.unites[0]) })
  }
  const setUnite = (unite) => update({ unite, prix_unitaire: prixDuMoment(refData, form.produit, unite) })

  const submit = async (e) => {
    e.preventDefault()
    const row = {
      ...cibleToIds(form.cible),
      date_vente: form.date_vente,
      produit: form.produit,
      unite: form.unite,
      quantite,
      prix_unitaire: Number(form.prix_unitaire),
      nombre_sujets: produitDef.sujets ? Number(form.nombre_sujets) : null,
      client_id: form.client_id || null,
      a_credit: credit,
      mode_paiement: credit ? (Number(form.acompte) > 0 ? form.mode_acompte : null) : form.paiement,
      montant_encaisse: credit ? Number(form.acompte) || 0 : 0,
      date_echeance: credit ? form.date_echeance || null : null,
      notes: form.notes || null
    }
    await enqueue(TABLES.ventes, row)
    setForm({ ...initial(form.activite), cible: form.cible })
    setSaved(true)
  }

  return (
    <form className="panel form" onSubmit={submit}>
      <FormHead kind="vente" />

      <div className="segmented small">
        {['chair', 'pondeuse'].map((a) => (
          <button key={a} type="button" className={form.activite === a ? 'active' : ''}
            onClick={() => { setSaved(false); setForm(initial(a)) }}>
            {t(`types.${a}_pl`)}
          </button>
        ))}
      </div>

      <div className="grid-2">
        <label className="field">
          <span>{t('saisie.date')}</span>
          <input type="date" required value={form.date_vente} onChange={set('date_vente')} />
        </label>
        <CibleSelect type={form.activite === 'chair' ? 'bande' : 'lot'} refData={refData}
          value={form.cible} onChange={set('cible')} hint={form.activite === 'chair' ? t('saisie.oldestFirst') : null} />
      </div>

      <div className="grid-2">
        <label className="field">
          <span>{t('saisie.produit')}</span>
          <select value={form.produit} onChange={(e) => setProduit(e.target.value)}>
            {PRODUITS[form.activite].map((p) => <option key={p.produit} value={p.produit}>{t(`produits.${p.produit}`)}</option>)}
          </select>
        </label>
        <label className="field">
          <span>{t('saisie.unite')}</span>
          <select value={form.unite} onChange={(e) => setUnite(e.target.value)}>
            {produitDef.unites.map((u) => <option key={u} value={u}>{t(`unites.${u}`)}</option>)}
          </select>
        </label>
      </div>

      <div className="grid-2">
        {produitDef.sujets && (
          <label className="field big">
            <span>{t('saisie.fields.nombre_sujets')}</span>
            <input type="number" inputMode="numeric" min="1" required placeholder="0"
              value={form.nombre_sujets} onChange={set('nombre_sujets')} />
          </label>
        )}
        {!quantiteEgaleSujets && (
          <label className="field big">
            <span>{t(`saisie.quantiteEn.${form.unite}`)}</span>
            <input type="number" inputMode="decimal" min="0.01" step="0.01" required placeholder="0"
              value={form.quantite} onChange={set('quantite')} />
          </label>
        )}
        <label className="field big">
          <span>{t('saisie.prixUnitaire', { unite: t(`unites.${form.unite}`) })}</span>
          <input type="number" inputMode="numeric" min="0" required placeholder="0"
            value={form.prix_unitaire} onChange={set('prix_unitaire')} />
        </label>
      </div>

      <div className="total-box">
        <span>{t('saisie.total')}</span>
        <strong>{fmt(total)} FCFA</strong>
      </div>

      <div className="field">
        <span>{t('saisie.paiement')}</span>
        <div className="segmented small">
          {[...MODES_PAIEMENT, 'credit'].map((m) => (
            <button key={m} type="button" className={form.paiement === m ? 'active' : ''}
              onClick={() => update({ paiement: m, client_id: '' })}>
              {t(`modes.${m}`)}
            </button>
          ))}
        </div>
      </div>

      <label className="field">
        <span>{credit ? t('saisie.clientCredit') : t('saisie.clientOptional')}</span>
        <select required={credit} value={form.client_id} onChange={set('client_id')}>
          <option value="">{credit ? (clients.length ? t('saisie.chooseClient') : t('saisie.noCreditClient')) : '—'}</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nom}{credit ? ` · ${t('saisie.plafond', { n: fmt(c.plafond_credit) })}` : ''}
            </option>
          ))}
        </select>
      </label>

      {credit && (
        <div className="grid-2">
          <label className="field">
            <span>{t('saisie.acompte')}</span>
            <input type="number" inputMode="numeric" min="0" max={total} placeholder="0"
              value={form.acompte} onChange={set('acompte')} />
          </label>
          {Number(form.acompte) > 0 && (
            <label className="field">
              <span>{t('saisie.modeAcompte')}</span>
              <select value={form.mode_acompte} onChange={set('mode_acompte')}>
                {MODES_PAIEMENT.map((m) => <option key={m} value={m}>{t(`modes.${m}`)}</option>)}
              </select>
            </label>
          )}
          <label className="field">
            <span>{t('saisie.echeance')}</span>
            <input type="date" value={form.date_echeance} onChange={set('date_echeance')} />
          </label>
        </div>
      )}

      <label className="field">
        <span>{t('saisie.notes')}</span>
        <textarea rows="2" value={form.notes} onChange={set('notes')} />
      </label>
      <p className="note"><Icon name="cloud" size={16} />{t('saisie.venteCheck')}</p>
      <Submit saved={saved} />
    </form>
  )
}

// ---------- Shared pieces ----------
function FormHead({ kind }) {
  const { t } = useTranslation()
  const def = FORMS[kind]
  return (
    <div className="panel-head">
      <span className={`kpi-icon ${def.tone}`}><Icon name={def.icon} size={22} /></span>
      <div>
        <h2>{t(`saisie.titles.${kind}`)}</h2>
        <p className="muted">{t(`saisie.hints.${kind}`)}</p>
      </div>
    </div>
  )
}

function Submit({ saved }) {
  const { t } = useTranslation()
  return (
    <>
      {saved && <div className="alert success"><Icon name="check" size={18} />{t('saisie.saved')}</div>}
      <button type="submit" className="btn primary block"><Icon name="check" size={18} />{t('saisie.save')}</button>
    </>
  )
}

// Flock picker. Values are "b:<bande_id>" or "l:<lot_id>".
function CibleSelect({ type, refData, value, onChange, hint }) {
  const { t } = useTranslation()
  const bandes = useMemo(() => refData.bandes.map((b) => (
    <option key={b.bande_id} value={`b:${b.bande_id}`}>{b.code} · {t('saisie.restants', { n: b.restants })}</option>
  )), [refData.bandes, t])
  const lots = useMemo(() => refData.lots.map((l) => (
    <option key={l.lot_id} value={`l:${l.lot_id}`}>{l.code} · {t('saisie.restants', { n: l.effectif })}</option>
  )), [refData.lots, t])
  const none = (type === 'bande' && !bandes.length) || (type === 'lot' && !lots.length)

  return (
    <label className="field">
      <span>{t(type === 'lot' ? 'saisie.lot' : type === 'bande' ? 'saisie.bande' : 'saisie.cible')}</span>
      <select required={type !== 'facultatif'} value={value} onChange={onChange}>
        <option value="" disabled={type !== 'facultatif'}>
          {type === 'facultatif' ? t('saisie.toute') : none ? t('saisie.noBande') : t('saisie.choose')}
        </option>
        {type === 'bande' && bandes}
        {type === 'lot' && lots}
        {(type === 'tous' || type === 'facultatif') && (
          <>
            {bandes.length > 0 && <optgroup label={t('types.chair_pl')}>{bandes}</optgroup>}
            {lots.length > 0 && <optgroup label={t('types.pondeuse_pl')}>{lots}</optgroup>}
          </>
        )}
      </select>
      {hint && <small className="muted">{hint}</small>}
    </label>
  )
}

function cibleToIds(cible) {
  if (cible?.startsWith('b:')) return { bande_id: cible.slice(2) }
  if (cible?.startsWith('l:')) return { lot_id: cible.slice(2) }
  return {}
}
