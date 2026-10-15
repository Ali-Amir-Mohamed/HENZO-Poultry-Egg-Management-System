import { useTranslation } from 'react-i18next'
import Icon from './Icon'

// Group portal ("Vos outils, un seul endroit"): one card per system, HENZO (farming) and HENZO AGRO (trading).
// Shown before signing in (choose which system to open) and after, to accounts working in both.
export default function Portail({ sousTitre, cartes, onChoisir, erreur, entete, pied, occupe }) {
  const { t } = useTranslation()
  return (
    <main className="portail">
      {entete && <div className="portail-entete">{entete}</div>}
      <div className="portail-inner">
        <p className="portail-marque">{t('systeme.brand')}</p>
        <h1>{t('systeme.title')}</h1>
        <p className="portail-sous-titre">{sousTitre}</p>
        <div className="portail-cartes">
          {cartes.map((c) => {
            const negoce = c.type === 'negoce'
            return (
              <button key={c.cle} type="button" className={`portail-carte ${negoce ? 'negoce' : 'elevage'}`} onClick={() => onChoisir(c)} disabled={!!occupe}>
                <span className="portail-icone"><Icon name={negoce ? 'box' : 'hen'} size={18} /></span>
                <strong>{t(negoce ? 'systeme.negoce' : 'systeme.elevage')}</strong>
                <span className="portail-desc">{t(negoce ? 'systeme.negoceHint' : 'systeme.elevageHint')}</span>
                <span className="portail-lien">{occupe === c.cle ? t('common.loading') : t('systeme.open', { nom: c.nom })} →</span>
                {c.role && <small className="portail-role">{t(`roles.${c.role}`)}{c.actif ? ` · ${t('systeme.last')}` : ''}</small>}
              </button>
            )
          })}
        </div>
        {erreur && <div className="alert danger"><Icon name="alert" size={18} />{erreur}</div>}
        <footer className="portail-pied">{pied}</footer>
      </div>
    </main>
  )
}
