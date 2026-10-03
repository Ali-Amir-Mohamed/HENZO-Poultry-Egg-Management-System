import Dexie from 'dexie'
import { supabase } from './supabase'

// Every entry is written here first, then pushed to Supabase when online.
// Records carry a client-generated UUID `id`, so re-sending after a dropped
// connection is idempotent (upsert ignoring duplicates on `id`).
export const db = new Dexie('henzo')
db.version(1).stores({
  outbox: '++seq, status, table, createdAt'
})

const listeners = new Set()
export const onQueueChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
const notify = () => listeners.forEach((fn) => fn())

export async function enqueue(table, record) {
  const row = { id: crypto.randomUUID(), ...record }
  await db.outbox.add({ table, row, status: 'pending', error: null, createdAt: new Date().toISOString() })
  notify()
  if (navigator.onLine) syncOutbox()
  return row
}

export const pendingCount = () => db.outbox.where('status').anyOf('pending', 'error').count()
export const listOutbox = () => db.outbox.orderBy('createdAt').reverse().toArray()

// An entry rejected by the server (e.g. credit ceiling exceeded) can be discarded by the user
export async function discardOutboxItem(seq) {
  await db.outbox.delete(seq)
  notify()
}

let syncing = null
export function syncOutbox() {
  if (!syncing) syncing = runSync().finally(() => { syncing = null })
  return syncing
}

async function runSync() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session || !navigator.onLine) return
  const items = await db.outbox.where('status').anyOf('pending', 'error').sortBy('seq')
  for (const item of items) {
    const { error } = await supabase
      .from(item.table)
      .upsert(item.row, { onConflict: 'id', ignoreDuplicates: true })
    if (error) {
      await db.outbox.update(item.seq, { status: 'error', error: error.message })
      // Network failure: stop and retry later; data errors are kept for review
      if (!navigator.onLine || error.message?.includes('Failed to fetch')) break
    } else {
      await db.outbox.delete(item.seq)
    }
    notify()
  }
}

export function startAutoSync() {
  window.addEventListener('online', syncOutbox)
  setInterval(() => navigator.onLine && syncOutbox(), 60_000)
  syncOutbox()
}
