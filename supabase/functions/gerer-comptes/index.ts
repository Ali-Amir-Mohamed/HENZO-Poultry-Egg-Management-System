// Supabase Edge Function « gerer-comptes »
// Création des comptes et réinitialisation des mots de passe depuis HENZO, réservée au directeur.
// La clé d'administration (service role) reste chez Supabase : elle n'est jamais envoyée à l'appli.
// Déploiement : Supabase > Edge Functions > Deploy a new function > Via Editor > nom « gerer-comptes ».
import { createClient } from 'npm:@supabase/supabase-js@2'

const DOMAIN = 'henzo.local'
const ROLES = ['directeur', 'exploitation', 'finance', 'employe']
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false }
    })

    // Qui appelle ? Seul un directeur actif est autorisé.
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: { user }, error: authError } = await admin.auth.getUser(token)
    if (authError || !user) return json({ error: 'Non connecté' }, 401)
    const { data: me } = await admin.from('profiles').select('role, actif, ferme_id').eq('id', user.id).single()
    if (!me || !me.actif || me.role !== 'directeur') return json({ error: 'Réservé au directeur' }, 403)

    const body = await req.json()
    const password = String(body.password ?? '')
    if (password.length < 8) return json({ error: 'Mot de passe : 8 caractères minimum' }, 400)

    if (body.action === 'create') {
      const identifiant = String(body.identifiant ?? '').trim().toLowerCase()
      if (!/^[a-z0-9._-]{2,30}$/.test(identifiant)) {
        return json({ error: 'Identifiant invalide : lettres minuscules, chiffres, point, tiret (2 à 30 caractères)' }, 400)
      }
      if (!ROLES.includes(body.role)) return json({ error: 'Rôle invalide' }, 400)
      const nom = String(body.nom_complet ?? '').trim()
      const { data, error } = await admin.auth.admin.createUser({
        email: `${identifiant}@${DOMAIN}`, password, email_confirm: true, user_metadata: { nom_complet: nom }
      })
      if (error) return json({ error: /already|exists/i.test(error.message) ? 'Cet identifiant existe déjà' : error.message }, 400)
      // Le profil est créé automatiquement (rôle « employe ») : on applique le rôle choisi
      const { error: roleError } = await admin.from('profiles').update({ role: body.role, nom_complet: nom }).eq('id', data.user.id)
      if (roleError) return json({ error: roleError.message }, 400)
      return json({ ok: true, id: data.user.id })
    }

    if (body.action === 'reset_password') {
      const { data: target } = await admin.from('profiles').select('ferme_id').eq('id', body.user_id).single()
      if (!target || target.ferme_id !== me.ferme_id) return json({ error: 'Compte introuvable' }, 404)
      const { error } = await admin.auth.admin.updateUserById(body.user_id, { password })
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    return json({ error: 'Action inconnue' }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
