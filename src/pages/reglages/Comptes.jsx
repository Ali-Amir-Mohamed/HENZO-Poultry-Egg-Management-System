import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { must, useQuery } from '../../hooks'
import { ROLES } from '../../config'
import Icon from '../../components/Icon'
import { Field, FormCard, Loading, Panel } from '../../components/ui'
import { useAsk, useRun } from '../../components/Dialog'

// Accounts of the active farm (director only): create, role, deactivate, password, add an existing account.
// Creation and password reset go through the « gerer-comptes » Edge Function (admin key stays at Supabase).
const ROLES_LIST = Object.values(ROLES)

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
  const ask = useAsk()
  const run = useRun()
  const list = useQuery(async () => must(await supabase.rpc('membres_ferme')))
  const [form, setForm] = useState({ identifiant: '', nom_complet: '', role: 'employe', password: '' })
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const roleOptions = ROLES_LIST.map((r) => ({ value: r, label: t(`roles.${r}`) }))

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
  const changeRole = async (p) => {
    const v = await ask.form({ title: t('comptes.roleTitle', { nom: p.nom_complet || p.identifiant }), icon: 'users', submit: t('dialog.save'),
      fields: [{ name: 'role', label: t('comptes.role'), type: 'select', value: p.role, options: roleOptions }] })
    if (v && v.role !== p.role) await run(supabase.rpc('definir_role', { p_user: p.user_id, p_role: v.role }), list.reload)
  }
  const resetPassword = async (p) => {
    const v = await ask.form({ title: t('comptes.passwordTitle', { id: p.identifiant }), icon: 'shield', submit: t('dialog.save'),
      fields: [{ name: 'password', label: t('comptes.newPassword'), type: 'text', required: true, hint: t('comptes.passwordHint') }] })
    if (!v) return
    if (v.password.length < 8) return ask.error(t('comptes.passwordTooShort'))
    try {
      await callAdmin({ action: 'reset_password', user_id: p.user_id, password: v.password })
      await ask.info(t('comptes.passwordDone'), t('comptes.passwordDoneText', { id: p.identifiant }))
    } catch (e) { ask.error(e.message) }
  }
  const toggleActive = async (p) => {
    const nom = p.nom_complet || p.identifiant
    if (!(await ask.confirm(t(p.actif ? 'comptes.confirmDisable' : 'comptes.confirmEnable', { nom }),
      { title: p.actif ? t('comptes.disable') : t('comptes.enable'), icon: 'users', danger: p.actif }))) return
    await run(supabase.from('profiles').update({ actif: !p.actif }).eq('id', p.user_id), list.reload)
  }
  // An account that already exists in another farm (e.g. Kenfack) can be added to this farm
  const addExisting = async () => {
    const v = await ask.form({ title: t('comptes.addExisting'), icon: 'users', submit: t('comptes.add'), fields: [
      { name: 'identifiant', label: t('comptes.username'), type: 'text', required: true },
      { name: 'role', label: t('comptes.roleHere'), type: 'select', value: 'employe', options: roleOptions }] })
    if (v) await run(supabase.rpc('ajouter_membre', { p_identifiant: v.identifiant, p_role: v.role }), list.reload)
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
              {roleOptions.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </Field>
          <Field label={t('comptes.password')}><input type="text" minLength={8} required value={form.password} onChange={set('password')} autoComplete="new-password" /></Field>
        </div>
        <p className="note"><Icon name="clock" size={16} />{t('comptes.hint')}</p>
      </FormCard>

      <Panel icon="users" tone="sky" title={t('comptes.list')}
        actions={<button className="btn ghost sm" onClick={addExisting}><Icon name="plus" size={14} />{t('comptes.addExisting')}</button>}>
        {!list.data ? <Loading error={list.error} /> : (
          <ul className="list">
            {list.data.map((p) => {
              const me = p.user_id === session.user.id
              return (
                <li key={p.user_id} className={p.actif ? '' : 'read'}>
                  <div className="grow">
                    <strong>{p.nom_complet || p.identifiant}{me ? ` (${t('comptes.you')})` : ''}</strong>
                    <div className="muted small">
                      {t('comptes.loginAs', { id: p.identifiant })}
                      {!p.ferme_active ? ` · ${t('comptes.activeElsewhere')}` : ''}
                    </div>
                    {!me && (
                      <div className="row-actions">
                        <button className="btn ghost sm" onClick={() => changeRole(p)}>{t('comptes.changeRole')}</button>
                        <button className="btn ghost sm" onClick={() => resetPassword(p)}>{t('comptes.resetPassword')}</button>
                        <button className="btn ghost sm" onClick={() => toggleActive(p)}>{p.actif ? t('comptes.disable') : t('comptes.enable')}</button>
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
