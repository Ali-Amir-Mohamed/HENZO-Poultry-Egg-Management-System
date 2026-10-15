import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthProvider'
import { usePendingCount } from '../hooks'
import { changerFerme } from '../components/FarmSwitch'
import { marquerChoix } from '../lib/systeme'
import Icon from '../components/Icon'

// Group portal for accounts working in both systems: one card per system (HENZO farming, HENZO AGRO trading).
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
    <main className="portail">
      <div className="portail-inner">
        <p className="portail-marque">{t('systeme.brand')}</p>
        <h1>{t('systeme.title')}</h1>
        <p className="portail-sous-titre">{t('systeme.subtitle', { name: prenom })}</p>

        <div className="portail-cartes">
          {societes.map((s) => {
            const negoce = s.type_activite === 'negoce'
            return (
              <button key={s.ferme_id} type="button" className={`portail-carte ${negoce ? 'negoce' : 'elevage'}`} onClick={() => choisir(s)} disabled={!!busy}>
                <span className="portail-icone"><Icon name={negoce ? 'box' : 'hen'} size={18} /></span>
                <strong>{t(negoce ? 'systeme.negoce' : 'systeme.elevage')}</strong>
                <span className="portail-desc">{t(negoce ? 'systeme.negoceHint' : 'systeme.elevageHint')}</span>
                <span className="portail-lien">{busy === s.ferme_id ? t('common.loading') : t('systeme.open', { nom: s.nom })} →</span>
                <small className="portail-role">{t(`roles.${s.role}`)}{s.active ? ` · ${t('systeme.last')}` : ''}</small>
              </button>
            )
          })}
        </div>

        {erreur && <div className="alert danger"><Icon name="alert" size={18} />{erreur}</div>}
        <footer className="portail-pied">
          <span>{t('systeme.footer')}</span>
          <button type="button" className="portail-deconnexion" onClick={signOut}>{t('nav.logout')}</button>
        </footer>
      </div>
    </main>
  )
}
