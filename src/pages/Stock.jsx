import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { must, useQuery } from '../hooks'
import { ARTICLE_CATEGORIES, ARTICLE_UNITES, can, TABLES } from '../config'
import { localDate } from '../lib/stats'
import Icon from '../components/Icon'
import { day, Empty, Field, FormCard, Loading, Panel } from '../components/ui'
import { useAsk, useRun } from '../components/Dialog'

// Stock: entries come from purchases (expenses), consumption from field entries.
export default function Stock() {
  const { t, i18n } = useTranslation()
  const { role } = useAuth()
  const lang = i18n.resolvedLanguage
  const fmt = (n) => Number(n ?? 0).toLocaleString(lang, { maximumFractionDigits: 2 })
  const ask = useAsk()
  const run = useRun()

  const stock = useQuery(async () => must(await supabase.from('stock_articles').select('*').order('nom')))
  const moves = useQuery(async () => must(await supabase.from(TABLES.mouvementsStock)
    .select('id, date_mouvement, type_mouvement, quantite, notes, depense_id, article:articles(nom, unite), bande:bandes(code), lot:lots_pondeuses(code)')
    .order('created_at', { ascending: false }).limit(40)))
  const reload = () => { stock.reload(); moves.reload() }

  const [article, setArticle] = useState({ nom: '', categorie: 'aliment', unite: 'sac', seuil_minimum: '0', poids_unitaire_kg: '50' })
  const [move, setMove] = useState({ article_id: '', type_mouvement: 'entree', quantite: '', cout_unitaire: '', date_mouvement: localDate(), notes: '' })

  const createArticle = async () => {
    const needsWeight = article.categorie === 'aliment' && article.unite !== 'kg'
    must(await supabase.from(TABLES.articles).insert({
      ...article,
      seuil_minimum: Number(article.seuil_minimum),
      poids_unitaire_kg: needsWeight && article.poids_unitaire_kg ? Number(article.poids_unitaire_kg) : null
    }))
    setArticle({ ...article, nom: '' })
    reload()
  }
  // A manual entry or adjustment typed by mistake can be removed (not purchases: cancel the expense instead)
  const removeMove = async (m) => {
    if (!(await ask.confirm(t('stock.confirmRemove', { q: fmt(m.quantite), unite: t(`unites.${m.article?.unite}`), nom: m.article?.nom }), { title: t('stock.remove'), icon: 'trash', danger: true }))) return
    await run(supabase.from(TABLES.mouvementsStock).delete().eq('id', m.id), reload)
  }

  // Edit a product: name, minimum level, bag weight, active
  const editArticle = async (s) => {
    const a = must(await supabase.from(TABLES.articles).select('*').eq('id', s.article_id).single())
    const v = await ask.form({ title: t('stock.editTitle', { nom: a.nom }), icon: 'box', submit: t('dialog.save'), fields: [
      { name: 'nom', label: t('stock.name'), value: a.nom, required: true },
      { name: 'seuil_minimum', label: t('stock.threshold'), type: 'number', value: a.seuil_minimum, min: 0, step: '0.01', required: true },
      ...(a.categorie === 'aliment' && a.unite !== 'kg'
        ? [{ name: 'poids_unitaire_kg', label: t('stock.unitWeight', { unite: t(`unites.${a.unite}`) }), type: 'number', value: a.poids_unitaire_kg ?? '', min: 0.001, step: '0.001', required: true }]
        : []),
      { name: 'actif', label: t('stock.status'), type: 'select', value: a.actif ? 'oui' : 'non', options: [{ value: 'oui', label: t('stock.active') }, { value: 'non', label: t('stock.inactive') }] }
    ] })
    if (!v) return
    const patch = { nom: v.nom, seuil_minimum: v.seuil_minimum, actif: v.actif === 'oui' }
    if ('poids_unitaire_kg' in v) patch.poids_unitaire_kg = v.poids_unitaire_kg
    await run(supabase.from(TABLES.articles).update(patch).eq('id', a.id), reload)
  }

  const createMove = async () => {
    must(await supabase.from(TABLES.mouvementsStock).insert({
      ...move,
      quantite: Number(move.quantite),
      cout_unitaire: move.type_mouvement === 'entree' && move.cout_unitaire ? Number(move.cout_unitaire) : null,
      notes: move.notes || null
    }))
    setMove({ ...move, quantite: '', cout_unitaire: '', notes: '' })
    reload()
  }

  return (
    <div className="stack">
      {!stock.data ? <Loading error={stock.error} /> : stock.data.length === 0 ? <Empty icon="box" text={t('stock.empty')} /> : (
        <div className="cards">
          {stock.data.map((s) => {
            // Low stock only when a threshold is set (or stock went negative)
            const low = (Number(s.seuil_minimum) > 0 && Number(s.stock) <= Number(s.seuil_minimum)) || Number(s.stock) < 0
            return (
              <article key={s.article_id} className={`card-item ${low ? 'alert-border' : ''}`}>
                <header>
                  <strong>{s.nom}</strong>
                  <span className="tag muted">{t(`articleCategories.${s.categorie}`)}</span>
                </header>
                <div className="stock-level">
                  <strong className={low ? 'error' : ''}>{fmt(s.stock)}</strong>
                  <span>{t(`unites.${s.unite}`)}</span>
                </div>
                <div className="facts">
                  <div className="fact"><span>{t('stock.threshold')}</span><strong>{fmt(s.seuil_minimum)}</strong></div>
                  <div className="fact"><span>{t('stock.perDay')}</span><strong>{fmt(s.conso_jour)}</strong></div>
                  <div className="fact"><span>{t('stock.autonomy')}</span><strong>{s.autonomie_jours != null ? t('dashboard.days', { n: s.autonomie_jours }) : '—'}</strong></div>
                </div>
                {low && <div className="alert danger"><Icon name="alert" size={16} />{t('stock.low')}</div>}
                {can(role, 'article.edit') && (
                  <footer><button className="btn ghost sm" onClick={() => editArticle(s)}><Icon name="note" size={14} />{t('common.edit')}</button></footer>
                )}
              </article>
            )
          })}
        </div>
      )}

      {can(role, 'article.edit') && (
        <FormCard title={t('stock.newArticle')} icon="box" onSubmit={createArticle}>
          <div className="grid-2">
            <Field label={t('stock.name')} className="span-2"><input required value={article.nom} onChange={(e) => setArticle({ ...article, nom: e.target.value })} placeholder="ex. Aliment démarrage chair" /></Field>
            <Field label={t('stock.category')}>
              <select value={article.categorie} onChange={(e) => setArticle({ ...article, categorie: e.target.value })}>
                {ARTICLE_CATEGORIES.map((c) => <option key={c} value={c}>{t(`articleCategories.${c}`)}</option>)}
              </select>
            </Field>
            <Field label={t('saisie.unite')}>
              <select value={article.unite} onChange={(e) => setArticle({ ...article, unite: e.target.value })}>
                {ARTICLE_UNITES.map((u) => <option key={u} value={u}>{t(`unites.${u}`)}</option>)}
              </select>
            </Field>
            <Field label={t('stock.threshold')}><input type="number" min="0" step="0.01" value={article.seuil_minimum} onChange={(e) => setArticle({ ...article, seuil_minimum: e.target.value })} /></Field>
            {article.categorie === 'aliment' && article.unite !== 'kg' && (
              <Field label={t('stock.unitWeight', { unite: t(`unites.${article.unite}`) })}>
                <input type="number" min="0.001" step="0.001" required value={article.poids_unitaire_kg} onChange={(e) => setArticle({ ...article, poids_unitaire_kg: e.target.value })} />
              </Field>
            )}
          </div>
        </FormCard>
      )}

      {can(role, 'stock.manual') && stock.data?.length > 0 && (
        <FormCard title={t('stock.manualMove')} icon="sync" onSubmit={createMove}>
          <p className="note"><Icon name="clock" size={16} />{t('stock.manualHint')}</p>
          <div className="grid-2">
            <Field label={t('saisie.article')}>
              <select required value={move.article_id} onChange={(e) => setMove({ ...move, article_id: e.target.value })}>
                <option value="" disabled>{t('saisie.chooseArticle')}</option>
                {stock.data.map((s) => <option key={s.article_id} value={s.article_id}>{s.nom}</option>)}
              </select>
            </Field>
            <Field label={t('stock.moveType')}>
              <select value={move.type_mouvement} onChange={(e) => setMove({ ...move, type_mouvement: e.target.value })}>
                <option value="entree">{t('stock.types.entree')}</option>
                <option value="ajustement">{t('stock.types.ajustement')}</option>
              </select>
            </Field>
            <Field label={move.type_mouvement === 'ajustement' ? t('stock.adjustQty') : t('argent.quantity')}>
              <input type="number" step="0.01" required value={move.quantite} onChange={(e) => setMove({ ...move, quantite: e.target.value })} />
            </Field>
            <Field label={t('saisie.date')}><input type="date" required value={move.date_mouvement} onChange={(e) => setMove({ ...move, date_mouvement: e.target.value })} /></Field>
            {move.type_mouvement === 'entree' && (
              <Field label={t('stock.unitCost')}><input type="number" min="0" value={move.cout_unitaire} onChange={(e) => setMove({ ...move, cout_unitaire: e.target.value })} /></Field>
            )}
          </div>
          <Field label={t('saisie.notes')}><input required={move.type_mouvement === 'ajustement'} value={move.notes} onChange={(e) => setMove({ ...move, notes: e.target.value })} /></Field>
        </FormCard>
      )}

      <Panel title={t('stock.history')}>
        {!moves.data ? <Loading error={moves.error} /> : moves.data.length === 0 ? <p className="muted">{t('stock.noMoves')}</p> : (
          <ul className="list">
            {moves.data.map((m) => (
              <li key={m.id}>
                <div className="grow">
                  <strong>{m.article?.nom}</strong>
                  <div className="muted small">
                    {day(m.date_mouvement, lang)} · {t(`stock.types.${m.type_mouvement}`)}
                    {m.bande ? ` · ${m.bande.code}` : m.lot ? ` · ${m.lot.code}` : ''}
                    {m.notes ? ` · ${m.notes}` : ''}
                    {m.depense_id ? ` · ${t('stock.fromPurchase')}` : ''}
                  </div>
                  {!m.depense_id && m.type_mouvement !== 'sortie' && can(role, 'stock.manual') && (
                    <div className="row-actions">
                      <button className="btn ghost sm" onClick={() => removeMove(m)}><Icon name="trash" size={14} />{t('stock.remove')}</button>
                    </div>
                  )}
                </div>
                <strong className={m.type_mouvement === 'sortie' || Number(m.quantite) < 0 ? 'error' : 'success'}>
                  {m.type_mouvement === 'sortie' ? '−' : Number(m.quantite) > 0 ? '+' : ''}{fmt(m.quantite)} {t(`unites.${m.article?.unite}`)}
                </strong>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
