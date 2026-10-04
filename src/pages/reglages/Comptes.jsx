import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { must, useQuery } from '../../hooks'
import { ROLES } from '../../config'
import Icon from '../../components/Icon'
import { Field, FormCard, Loading, Panel } from '../../components/ui'

// Accounts (director only): create accounts, change roles, deactivate, reset passwords.
// Creation and password reset go through the « gerer-comptes » Edge Function (admin key stays at Supabase).
async function callAdmin(body) {
  const { data, error } = await supabase.functions.invoke('gerer-comptes', { body })
  if (error) {
    let message = error.message
    try { message = (await error.context.json()).error ?? message } catch {}
    throw new Error(message)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

export default function Comptes() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const list = useQuery(async () => must(await supabase.from('profiles').select('id, identifiant, nom_complet, role, actif, created_at').order('role').order('nom_complet')))
  const [form, setForm] = useState({ identifiant: '', nom_complet: '', role: 'employe', password: '' })
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const create = async () => {
    try {
      await callAdmin({ action: 'create', ...form })
    } catch (e) {
      if (/Failed to send|not found|404|FunctionsFetchError|FunctionsHttpError/i.test(e.message)) throw new Error(t('comptes.noFunction'))
      throw e
    }
    const msg = t('comptes.created', { id: form.identifiant })
    setForm({ identifiant: '', nom_complet: '', role: 'employe', password: '' })
    list.reload()
    return msg
  }
  const update = async (p, patch) => {
    const { error } = await supabase.from('profiles').update(patch).eq('id', p.id)
    if (error) window.alert(error.message)
    list.reload()
  }
  const changeRole = (p) => {
    const choices = ROLES_LIST.map((r, i) => `${i + 1} = ${t(`roles.${r}`)}`).join(', ')
    const c = window.prompt(t('comptes.rolePrompt', { nom: p.nom_complet || p.identifiant, choices }))
    const role = ROLES_LIST[Number(c) - 1]
    if (role && role !== p.role) update(p, { role })
  }
  const resetPassword = async (p) => {
    const password = window.prompt(t('comptes.passwordPrompt', { id: p.identifiant }))
    if (!password) return
    try {
      await callAdmin({ action: 'reset_password', user_id: p.id, password })
      window.alert(t('comptes.passwordDone'))
    } catch (e) { window.alert(e.message) }
  }

  return (
    <>
      <FormCard title={t('comptes.new')} icon="users" onSubmit={create}>
        <div className="grid-2">
          <Field label={t('comptes.username')}>
            <input required pattern="[a-z0-9._\-]{2,30}" autoCapitalize="none" value={form.identifiant}
              onChange={(e) => setForm({ ...form, identifiant: e.target.value.toLowerCase().replace(/\s/g, '') })} placeholder="ex. paul" />
          </Field>
          <Field label={t('comptes.fullName')}><input required value={form.nom_complet} onChange={set('nom_complet')} /></Field>
          <Field label={t('comptes.role')}>
            <select value={form.role} onChange={set('role')}>
              {ROLES_LIST.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
            </select>
          </Field>
          <Field label={t('comptes.password')}><input type="text" minLength={8} required value={form.password} onChange={set('password')} autoComplete="new-password" /></Field>
        </div>
        <p className="note"><Icon name="clock" size={16} />{t('comptes.hint')}</p>
      </FormCard>

      <Panel icon="users" tone="sky" title={t('comptes.list')}>
        {!list.data ? <Loading error={list.error} /> : (
          <ul className="list">
            {list.data.map((p) => {
              const me = p.id === session.user.id
              return (
                <li key={p.id} className={p.actif ? '' : 'read'}>
                  <div className="grow">
                    <strong>{p.nom_complet || p.identifiant}{me ? ` (${t('comptes.you')})` : ''}</strong>
                    <div className="muted small">{t('comptes.loginAs', { id: p.identifiant })}</div>
                    {!me && (
                      <div className="row-actions">
                        <button className="btn ghost sm" onClick={() => changeRole(p)}>{t('comptes.changeRole')}</button>
                        <button className="btn ghost sm" onClick={() => resetPassword(p)}>{t('comptes.resetPassword')}</button>
                        <button className="btn ghost sm" onClick={() => window.confirm(t(p.actif ? 'comptes.confirmDisable' : 'comptes.confirmEnable', { nom: p.nom_complet || p.identifiant })) && update(p, { actif: !p.actif })}>
                          {p.actif ? t('comptes.disable') : t('comptes.enable')}
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="right">
                    <span className="tag ok">{t(`roles.${p.role}`)}</span>
                    {!p.actif && <span className="tag danger">{t('comptes.disabled')}</span>}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>
    </>
  )
}

const ROLES_LIST = Object.values(ROLES)
