import { useState } from 'react'
import { Tabs } from '../components/ui'
import Factures from './compta/Factures'
import Impots from './compta/Impots'
import Societe from './compta/Societe'

// Accounting and taxes: official invoices, monthly taxes, the company's legal sheet
const TABS = [
  { id: 'factures', label: 'compta.tabs.factures', icon: 'receipt' },
  { id: 'impots', label: 'compta.tabs.impots', icon: 'wallet' },
  { id: 'societe', label: 'compta.tabs.societe', icon: 'note' }
]

export default function Compta() {
  const [tab, setTab] = useState(() => { try { return sessionStorage.getItem('henzo.compta.tab') || 'factures' } catch { return 'factures' } })
  const choose = (k) => { setTab(k); try { sessionStorage.setItem('henzo.compta.tab', k) } catch { /* ignore */ } }
  return (
    <div className="stack">
      <Tabs value={tab} onChange={choose} tabs={TABS} />
      {tab === 'factures' && <Factures />}
      {tab === 'impots' && <Impots />}
      {tab === 'societe' && <Societe />}
    </div>
  )
}
