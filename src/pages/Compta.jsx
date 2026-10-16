import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { can } from '../config'
import { Tabs } from '../components/ui'
import Factures from './compta/Factures'
import Impots from './compta/Impots'
import Societe from './compta/Societe'
import Livres from './compta/Livres'
import PaieTotaux from './compta/PaieTotaux'

// Accounting and taxes: official invoices, monthly taxes, accounting books (direction, finance), the company's legal sheet
const TABS = [
  { id: 'factures', label: 'compta.tabs.factures', icon: 'receipt' },
  { id: 'impots', label: 'compta.tabs.impots', icon: 'wallet' },
  { id: 'livres', label: 'compta.tabs.livres', icon: 'chart', perm: 'compta.livres' },
  { id: 'paie', label: 'compta.tabs.paie', icon: 'users', perm: 'compta.paie' },
  { id: 'societe', label: 'compta.tabs.societe', icon: 'note' }
]

export default function Compta() {
  const { role } = useAuth()
  const tabs = TABS.filter((x) => !x.perm || can(role, x.perm))
  const [tab, setTab] = useState(() => { try { return sessionStorage.getItem('henzo.compta.tab') || 'factures' } catch { return 'factures' } })
  const actif = tabs.some((x) => x.id === tab) ? tab : tabs[0].id
  const choose = (k) => { setTab(k); try { sessionStorage.setItem('henzo.compta.tab', k) } catch { /* ignore */ } }
  return (
    <div className="stack">
      <Tabs value={actif} onChange={choose} tabs={tabs} />
      {actif === 'factures' && <Factures />}
      {actif === 'impots' && <Impots />}
      {actif === 'livres' && <Livres />}
      {actif === 'paie' && <PaieTotaux />}
      {actif === 'societe' && <Societe />}
    </div>
  )
}
