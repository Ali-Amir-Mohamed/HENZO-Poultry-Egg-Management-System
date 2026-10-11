import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useQuery } from '../hooks'
import Icon from '../components/Icon'
import { Loading, Panel } from '../components/ui'
import { useAsk } from '../components/Dialog'
import { faceIdSupported, marquerFaceId, messageFaceId, nomBiometrie } from '../lib/faceid'

// Face ID / fingerprint sign-in for the current account (every role, employees included).
// Activating it asks for the password first: only the owner of the account can add a passkey.
export default function FaceId() {
  const { t, i18n } = useTranslation()
  const { session } = useAuth()
  const ask = useAsk()
  const lang = i18n.resolvedLanguage
  const nom = nomBiometrie()
  const q = useQuery(async () => {
    const { data, error } = await supabase.auth.passkey.list()
    if (error) throw new Error(messageFaceId(error, t))
    return data ?? []
  })

  const activer = async () => {
    const v = await ask.form({ title: t('faceid.activateTitle', { nom }), icon: 'check', submit: t('faceid.continue'),
      message: t('faceid.activateHint', { nom }),
      fields: [{ name: 'password', label: t('auth.password'), type: 'password', required: true }] })
    if (!v) return
    // Password check: protects against someone who would pick up an unlocked phone
    const check = await supabase.auth.signInWithPassword({ email: session.user.email, password: v.password })
    if (check.error) return ask.error(t('faceid.wrongPassword'))
    const { error } = await supabase.auth.registerPasskey()
    if (error) return ask.error(messageFaceId(error, t))
    marquerFaceId(true)
    q.reload()
    await ask.info(t('faceid.doneTitle', { nom }), t('faceid.doneText', { nom }))
  }

  const retirer = async (p) => {
    if (!(await ask.confirm(t('faceid.confirmRemove', { nom: p.friendly_name || nom }), { title: t('faceid.remove'), icon: 'trash', danger: true, submit: t('faceid.remove') }))) return
    const { error } = await supabase.auth.passkey.delete({ passkeyId: p.id })
    if (error) return ask.error(messageFaceId(error, t))
    if ((q.data ?? []).length <= 1) marquerFaceId(false)
    q.reload()
  }

  if (!faceIdSupported()) {
    return <Panel icon="alert" tone="rose" title={t('faceid.title', { nom })}><p className="muted">{t('faceid.unsupported')}</p></Panel>
  }

  return (
    <div className="stack">
      <Panel icon="check" tone="green" title={t('faceid.title', { nom })} subtitle={t('faceid.subtitle', { nom })}>
        <ul className="small">
          <li>{t('faceid.point1', { nom })}</li>
          <li>{t('faceid.point2')}</li>
          <li>{t('faceid.point3')}</li>
          <li>{t('faceid.point4', { nom })}</li>
        </ul>
        <button className="btn primary block" onClick={activer}><Icon name="plus" size={16} />{t('faceid.activate', { nom })}</button>
      </Panel>

      <Panel title={t('faceid.devices')}>
        {!q.data ? <Loading error={q.error} /> : q.data.length === 0 ? <p className="muted">{t('faceid.none')}</p> : (
          <ul className="list">
            {q.data.map((p) => (
              <li key={p.id}>
                <div className="grow">
                  <strong>{p.friendly_name || t('faceid.device')}</strong>
                  <div className="muted small">
                    {t('faceid.addedOn', { d: new Date(p.created_at).toLocaleDateString(lang) })}
                    {p.last_used_at ? ` · ${t('faceid.lastUsed', { d: new Date(p.last_used_at).toLocaleString(lang) })}` : ''}
                  </div>
                </div>
                <button className="btn ghost sm" onClick={() => retirer(p)} aria-label={t('faceid.remove')}><Icon name="trash" size={14} /></button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
