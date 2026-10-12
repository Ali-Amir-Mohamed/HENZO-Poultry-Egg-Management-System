import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useQuery } from '../hooks'
import { can } from '../config'
import { Empty, Loading, Tabs } from '../components/ui'
import Vendre from './boutique/Vendre'
import StockBoutique from './boutique/StockBoutique'
import Envois from './boutique/Envois'
import CaisseBoutique from './boutique/CaisseBoutique'
import VentesBoutique from './boutique/VentesBoutique'
import GestionBoutiques from './boutique/GestionBoutiques'

// Shops. A seller sees only his shop (Vendre, Stock, Réceptions, Caisse);
// the direction chooses a shop and also manages shipments, prices, deposits and the shops themselves.
export default function Boutique() {
  const { t } = useTranslation()
  const { role } = useAuth()
  const vendeur = role === 'vendeur'
  const list = useQuery(async () => {
    const { data, error } = await supabase.from('boutiques').select('id, nom, adresse, telephone, actif').order('nom')
    if (error && !navigator.onLine) return JSON.parse(localStorage.getItem('henzo.boutiques') || '[]')
    if (error) throw error
    try { localStorage.setItem('henzo.boutiques', JSON.stringify(data)) } catch { /* ignore */ }
    return data
  })
  const [choix, setChoix] = useState(() => { try { return localStorage.getItem('henzo.boutique.choix') || '' } catch { return '' } })
  const boutiques = (list.data ?? []).filter((b) => b.actif || !vendeur)
  const boutique = boutiques.find((b) => b.id === choix) ?? boutiques[0]
  useEffect(() => { if (boutique) try { localStorage.setItem('henzo.boutique.choix', boutique.id) } catch { /* ignore */ } }, [boutique])

  const tabs = [
    ...(can(role, 'boutique.vendre') ? [{ id: 'vendre', label: 'boutique.tabs.vendre', icon: 'cart' }] : []),
    ...(can(role, 'boutique.ventes') ? [{ id: 'ventes', label: 'boutique.tabs.ventes', icon: 'receipt' }] : []),
    { id: 'stock', label: 'boutique.tabs.stock', icon: 'box' },
    { id: 'envois', label: vendeur ? 'boutique.tabs.receptions' : 'boutique.tabs.envois', icon: 'drumstick' },
    ...(can(role, 'boutique.caisse.voir') ? [{ id: 'caisse', label: 'boutique.tabs.caisse', icon: 'wallet' }] : []),
    ...(can(role, 'boutique.prix') || can(role, 'boutique.admin') ? [{ id: 'gestion', label: 'boutique.tabs.gestion', icon: 'settings' }] : [])
  ]
  const [tab, setTab] = useState(tabs[0].id)
  const actif = tabs.some((x) => x.id === tab) ? tab : tabs[0].id

  if (!list.data) return <Loading error={list.error} />
  if (!boutiques.length) {
    return actif === 'gestion' || can(role, 'boutique.admin')
      ? <div className="stack"><Empty icon="cart" text={vendeur ? t('boutique.noShopSeller') : t('boutique.noShop')} />{can(role, 'boutique.admin') && <GestionBoutiques onChange={list.reload} />}</div>
      : <Empty icon="cart" text={vendeur ? t('boutique.noShopSeller') : t('boutique.noShop')} />
  }

  return (
    <div className="stack">
      {vendeur ? <h2 className="section-title">{boutique.nom}</h2> : (
        <label className="field shop-select"><span>{t('boutique.shop')}</span>
          <select value={boutique.id} onChange={(e) => setChoix(e.target.value)}>
            {boutiques.map((b) => <option key={b.id} value={b.id}>{b.nom}{b.actif ? '' : ` (${t('boutique.closed')})`}</option>)}
          </select>
        </label>
      )}
      <Tabs value={actif} onChange={setTab} tabs={tabs} />
      {actif === 'vendre' && <Vendre boutique={boutique} />}
      {actif === 'ventes' && <VentesBoutique boutique={boutique} />}
      {actif === 'stock' && <StockBoutique boutique={boutique} />}
      {actif === 'envois' && <Envois boutique={boutique} />}
      {actif === 'caisse' && <CaisseBoutique boutique={boutique} />}
      {actif === 'gestion' && <GestionBoutiques boutique={boutique} onChange={list.reload} />}
    </div>
  )
}
