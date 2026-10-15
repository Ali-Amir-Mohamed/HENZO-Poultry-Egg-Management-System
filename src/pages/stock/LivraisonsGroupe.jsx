import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { must, useQuery } from '../../hooks'
import { can, TABLES } from '../../config'
import Icon from '../../components/Icon'
import { day, Loading, money, Panel } from '../../components/ui'
import { useAsk, useRun } from '../../components/Dialog'

// Deliveries between group companies.
// Buyer side (HENZO): to receive (operations: creates the credit purchase, validated by finance) or refuse.
// Seller side (HENZO AGRO): the deliveries sent and what happened to them.
export default function LivraisonsGroupe() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const { role, profile } = useAuth()
  const ask = useAsk()
  const run = useRun()
  const q = useQuery(async () => {
    const [livraisons, societes] = await Promise.all([
      supabase.from('achats_intersocietes').select('*').order('created_at', { ascending: false }).limit(40),
      supabase.rpc('mes_societes')
    ])
    return { livraisons: must(livraisons), noms: Object.fromEntries((societes.data ?? []).map((s) => [s.ferme_id, s.nom])) }
  })

  const receptionner = async (l) => {
    let article = null
    if (['aliment', 'medicament'].includes(l.categorie)) {
      const arts = must(await supabase.from(TABLES.articles).select('id, nom').eq('categorie', l.categorie).eq('actif', true).order('nom'))
      const v = await ask.form({ title: t('groupe.receiveTitle', { nom: l.article_nom }), icon: 'box', submit: t('groupe.receive'), message: t('groupe.receiveHint'), fields: [
        { name: 'article', label: t('groupe.stockProduct'), type: 'select', value: arts.find((a) => a.nom.toLowerCase() === l.article_nom.toLowerCase())?.id ?? '',
          options: [{ value: '', label: t('groupe.newProduct', { nom: l.article_nom }) }, ...arts.map((a) => ({ value: a.id, label: a.nom }))] }
      ] })
      if (!v) return
      article = v.article || null
    } else if (!(await ask.confirm(t('groupe.receiveConfirm', { q: Number(l.quantite).toLocaleString(lang), unite: t(`unites.${l.unite}`), nom: l.article_nom, n: money(l.montant, lang) }),
      { title: t('groupe.receive'), icon: 'box', submit: t('groupe.receive') }))) return
    await run(supabase.rpc('receptionner_livraison_groupe', { p_achat: l.id, p_article: article }), q.reload)
  }
  const refuser = async (l) => {
    const motif = await ask.reason(t('groupe.refuseTitle', { nom: l.article_nom }))
    if (motif) await run(supabase.rpc('refuser_livraison_groupe', { p_achat: l.id, p_motif: motif }), q.reload)
  }

  if (!q.data) return <Loading error={q.error} />
  const recues = q.data.livraisons.filter((l) => l.ferme_id === profile?.ferme_id)
  const envoyees = q.data.livraisons.filter((l) => l.ferme_vendeuse_id === profile?.ferme_id)
  const aTraiter = recues.filter((l) => l.statut === 'en_attente')
  const tag = (l) => <span className={`tag ${{ en_attente: 'warn', receptionne: 'ok', refuse: 'danger', annule: 'muted' }[l.statut]}`}>{t(`groupe.status.${l.statut}`)}</span>
  const ligne = (l, autre, actions) => (
    <li key={l.id}>
      <div className="grow">
        <strong>{l.article_nom}</strong> · {Number(l.quantite).toLocaleString(lang)} {t(`unites.${l.unite}`)}
        <div className="muted small">{day(l.date_livraison, lang)} · {q.data.noms[autre] ?? t('groupe.company')}{l.motif ? ` · ${l.motif}` : ''}</div>
        {actions}
      </div>
      <div className="right"><strong>{money(l.montant, lang)}</strong>{tag(l)}</div>
    </li>
  )

  return (
    <>
      {recues.length > 0 && (
        <Panel icon="box" tone={aTraiter.length ? 'yolk' : 'green'} title={t('groupe.receivedTitle')} subtitle={aTraiter.length ? t('groupe.toReceive', { count: aTraiter.length }) : t('groupe.allDone')}>
          <ul className="list">
            {recues.slice(0, 15).map((l) => ligne(l, l.ferme_vendeuse_id, l.statut === 'en_attente' && (
              <div className="row-actions">
                {can(role, 'groupe.receptionner') && <button className="btn primary sm" onClick={() => receptionner(l)}><Icon name="check" size={14} />{t('groupe.receive')}</button>}
                {can(role, 'groupe.refuser') && <button className="btn ghost sm" onClick={() => refuser(l)}>{t('groupe.refuse')}</button>}
              </div>
            )))}
          </ul>
          <p className="muted small">{t('groupe.receivedHint')}</p>
        </Panel>
      )}
      {envoyees.length > 0 && (
        <Panel icon="drumstick" tone="sky" title={t('groupe.sentTitle')}>
          <ul className="list">{envoyees.slice(0, 15).map((l) => ligne(l, l.ferme_id, null))}</ul>
          <p className="muted small">{t('groupe.sentHint')}</p>
        </Panel>
      )}
    </>
  )
}
