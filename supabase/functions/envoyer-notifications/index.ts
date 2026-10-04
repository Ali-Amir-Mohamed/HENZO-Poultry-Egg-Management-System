// Supabase Edge Function « envoyer-notifications »
// Appelée par un Database Webhook à chaque nouvelle ligne de « notifications » :
// envoie la notification sur les téléphones abonnés des comptes de ce rôle dans cette ferme.
// Secrets nécessaires (Edge Functions > Secrets) : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, WEBHOOK_SECRET.
// Déploiement : nom « envoyer-notifications », « Verify JWT » désactivé (le webhook est vérifié par WEBHOOK_SECRET).
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

// Liens écrits par la base → pages de l'appli
const lienAppli = (lien: string | null) => {
  if (!lien) return '/'
  if (lien.startsWith('/bandes/')) return lien.replace('/bandes/', '/ferme/bande/')
  if (lien.startsWith('/lots/')) return lien.replace('/lots/', '/ferme/lot/')
  if (lien.startsWith('/depenses')) return '/argent'
  return lien.startsWith('/') ? lien : '/'
}

Deno.serve(async (req) => {
  if (req.headers.get('x-henzo-secret') !== Deno.env.get('WEBHOOK_SECRET')) {
    return new Response('Non autorisé', { status: 401 })
  }
  try {
    const { type, record } = await req.json()
    if (type !== 'INSERT' || !record) return new Response('ignoré')

    // Contact déclaré aux services Google / Apple / Mozilla : l'adresse du site (une adresse .local est refusée par certains)
    webpush.setVapidDetails('https://henzo.henzo-ferme.workers.dev', Deno.env.get('VAPID_PUBLIC_KEY')!.trim(), Deno.env.get('VAPID_PRIVATE_KEY')!.trim())
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false }
    })

    // Comptes actifs de ce rôle dans cette ferme
    const { data: membres } = await admin.from('membres_fermes').select('user_id, profile:profiles(actif)')
      .eq('ferme_id', record.ferme_id).eq('role', record.role_destinataire)
    const ids = (membres ?? []).filter((m: any) => m.profile?.actif).map((m: any) => m.user_id)
    if (!ids.length) return new Response('aucun destinataire')

    const { data: abonnements } = await admin.from('abonnements_push').select('id, endpoint, p256dh, auth').in('user_id', ids)
    const payload = JSON.stringify({ title: 'HENZO', body: record.message, url: lienAppli(record.lien), tag: record.type_notification })

    let envoyes = 0
    const erreurs: string[] = []
    await Promise.all((abonnements ?? []).map(async (a: any) => {
      const service = new URL(a.endpoint).host
      try {
        await webpush.sendNotification({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } }, payload, { TTL: 60 * 60 * 24 })
        envoyes++
      } catch (e: any) {
        // Raison de l'échec, lisible dans net._http_response et dans les Logs de la fonction
        const detail = `${service} : ${e?.statusCode ?? ''} ${String(e?.body ?? e?.message ?? e).slice(0, 200)}`
        console.error('Envoi impossible', detail)
        erreurs.push(detail)
        // Téléphone désabonné ou appli désinstallée : on oublie l'abonnement
        if (e?.statusCode === 404 || e?.statusCode === 410) await admin.from('abonnements_push').delete().eq('id', a.id)
      }
    }))
    return new Response(JSON.stringify({ envoyes, abonnements: (abonnements ?? []).length, erreurs }), { headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(e instanceof Error ? e.message : String(e), { status: 500 })
  }
})
