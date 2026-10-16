import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useQuery } from '../hooks'
import Icon from './Icon'

// The invoice of a sale: made by the server when the sale is recorded. A sale still waiting to be sent
// (offline) gets its invoice number as soon as it reaches the server.
export default function BoutonFacture({ vente, venteBoutique, enAttente, big }) {
  const { t } = useTranslation()
  const q = useQuery(async () => {
    if (enAttente || !navigator.onLine) return null
    const { data } = await supabase.rpc('facture_pour', vente ? { p_vente: vente } : { p_vente_boutique: venteBoutique })
    return data ?? null
  }, [vente, venteBoutique, enAttente])
  if (enAttente) return <p className="note no-print"><Icon name="cloud" size={16} />{t('compta.fact.pendingSale')}</p>
  if (!q.data) return null
  return <Link to={`/facture/${q.data}`} className={`btn ${big ? 'primary' : 'ghost'} ${big ? 'block' : 'sm'} no-print`}><Icon name="receipt" size={16} />{t('compta.fact.openInvoice')}</Link>
}
