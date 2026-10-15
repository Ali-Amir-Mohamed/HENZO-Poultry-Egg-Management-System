import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthProvider'
import { usePendingCount } from '../hooks'
import { changerFerme } from '../components/FarmSwitch'
import { marquerChoix } from '../lib/systeme'
import Icon, { Logo } from '../components/Icon'

// Welcome screen for accounts working in both systems: HENZO (farm) or HENZO AGRO (trading).
export default function ChoixSysteme({ societes, onChoisi }) {
  const { t } = useTranslation()
  const { profile, signOut } = useAuth()
  const pending = usePendingCount()
  const [erreur, setErreur] = useState(null)
  const [busy, setBusy] = useState(null)
  const prenom = (profile?.nom_complet || '').split(' ')[0]

  const choisir = async (s) => {
    setErreur(null)
    marquerChoix()
    if (s.active) return onChoisi()
    if (pending > 0) return setErreur(t('fermes.pendingFirst', { count: pending }))
    setBusy(s.ferme_id)
    try { await changerFerme(s.ferme_id) } catch (err) { setErreur(err.message); setBusy(null) }
  }

  return (
    <div className="choix-systeme">
      <div className="choix-head">
        <Logo size={56} />
        <h1>{t('systeme.welcome', { name: prenom })}</h1>
        <p>{t('systeme.pick')}</p>
      </div>
      <div className="choix-cartes">
        {societes.map((s) => {
          const negoce = s.type_activite === 'negoce'
          return (
            <button key={s.ferme_id} type="button" className={`choix-carte ${negoce ? 'negoce' : 'elevage'}`} onClick={() => choisir(s)} disabled={!!busy}>
              <span className="choix-icone"><Icon name={negoce ? 'box' : 'hen'} size={34} /></span>
              <strong>{s.nom}</strong>
              <span>{t(negoce ? 'systeme.negoce' : 'systeme.elevage')}</span>
              <small>{t(negoce ? 'systeme.negoceHint' : 'systeme.elevageHint')}</small>
              <small className="choix-role">{t(`roles.${s.role}`)}{s.active ? ` · ${t('systeme.last')}` : ''}</small>
              {busy === s.ferme_id && <small>{t('common.loading')}</small>}
            </button>
          )
        })}
      </div>
      {erreur && <div className="alert danger"><Icon name="alert" size={18} />{erreur}</div>}
      <button type="button" className="btn ghost" onClick={signOut}><Icon name="logout" size={16} />{t('nav.logout')}</button>
    </div>
  )
}
