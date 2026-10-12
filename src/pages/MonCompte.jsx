import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import Icon from '../components/Icon'
import { Field, Panel } from '../components/ui'
import { faceIdSupported, nomBiometrie } from '../lib/faceid'
import { APP_VERSION } from '../lib/version'

// My account (every role): change my own password, Face ID, version.
// The current password is checked first: someone holding an unlocked phone cannot change it.
export default function MonCompte() {
  const { t } = useTranslation()
  const { session, profile, role } = useAuth()
  const [form, setForm] = useState({ actuel: '', nouveau: '', confirmation: '' })
  const [state, setState] = useState({ busy: false, error: null, done: false })
  const set = (k) => (e) => { setState({ busy: false, error: null, done: false }); setForm({ ...form, [k]: e.target.value }) }
  const identifiant = (session?.user?.email ?? '').split('@')[0]

  const changer = async (e) => {
    e.preventDefault()
    if (form.nouveau.length < 8) return setState({ busy: false, error: t('compte.tooShort'), done: false })
    if (form.nouveau !== form.confirmation) return setState({ busy: false, error: t('compte.mismatch'), done: false })
    if (form.nouveau === form.actuel) return setState({ busy: false, error: t('compte.same'), done: false })
    if (!navigator.onLine) return setState({ busy: false, error: t('auth.offline'), done: false })
    setState({ busy: true, error: null, done: false })
    const check = await supabase.auth.signInWithPassword({ email: session.user.email, password: form.actuel })
    if (check.error) return setState({ busy: false, error: t('compte.wrongCurrent'), done: false })
    const { error } = await supabase.auth.updateUser({ password: form.nouveau })
    if (error) return setState({ busy: false, error: error.message, done: false })
    setForm({ actuel: '', nouveau: '', confirmation: '' })
    setState({ busy: false, error: null, done: true })
  }

  return (
    <div className="stack">
      <Panel icon="users" tone="green" title={profile?.nom_complet || identifiant}
        subtitle={`${t('compte.username')} : ${identifiant} · ${t(`roles.${role}`)}`} />

      <form className="panel" onSubmit={changer}>
        <div className="panel-head">
          <span className="kpi-icon sky"><Icon name="check" size={22} /></span>
          <div><h2>{t('compte.passwordTitle')}</h2><p className="muted">{t('compte.passwordHint')}</p></div>
        </div>
        <Field label={t('compte.current')}><input type="password" autoComplete="current-password" required value={form.actuel} onChange={set('actuel')} /></Field>
        <Field label={t('compte.new')}><input type="password" autoComplete="new-password" minLength={8} required value={form.nouveau} onChange={set('nouveau')} /></Field>
        <Field label={t('compte.confirm')}><input type="password" autoComplete="new-password" minLength={8} required value={form.confirmation} onChange={set('confirmation')} /></Field>
        {state.error && <div className="alert danger"><Icon name="alert" size={18} />{state.error}</div>}
        {state.done && <div className="alert success"><Icon name="check" size={18} />{t('compte.done')}</div>}
        <button type="submit" className="btn primary block" disabled={state.busy}>{state.busy ? t('common.loading') : t('compte.save')}</button>
      </form>

      {faceIdSupported() && (
        <Link to="/face-id" className="panel link-panel"><Icon name="check" size={18} />{t('faceid.menu', { nom: nomBiometrie() })}<Icon name="chevron" size={16} /></Link>
      )}
      <p className="muted small center">{t('version.label')} {APP_VERSION}</p>
    </div>
  )
}
