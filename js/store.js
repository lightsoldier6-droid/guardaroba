// Dati: cache locale (IndexedDB) + coda di modifiche (outbox) sincronizzata con Supabase.
// L'interfaccia legge sempre dalla cache, quindi funziona anche con rete scarsa o assente.
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js'
import * as idb from './idb.js'

export const configured = !!(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY)
export const sb = configured
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    })
  : null

export const BUCKET = 'wardrobe'
const TABLES = ['items', 'wear_log', 'measurements']
const KEY = { items: 'items', wear_log: 'wearLog', measurements: 'measures' }

export const state = {
  user: null, items: [], wearLog: [], measures: [],
  pending: 0, syncing: false, lastSync: null, online: navigator.onLine, errors: [],
}
const listeners = new Set()
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn))
const emit = () => listeners.forEach((fn) => { try { fn(state) } catch (e) { console.error(e) } })

const sortAll = () => {
  state.items.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
  state.wearLog.sort((a, b) => b.worn_on.localeCompare(a.worn_on))
  state.measures.sort((a, b) => b.measured_on.localeCompare(a.measured_on))
}

async function saveCache() {
  await idb.put('kv', { items: state.items, wearLog: state.wearLog, measures: state.measures, lastSync: state.lastSync, userId: state.user?.id }, 'cache')
}

export async function loadCache(userId) {
  const c = await idb.get('kv', 'cache')
  if (c && c.userId === userId) {
    state.items = c.items || []; state.wearLog = c.wearLog || []; state.measures = c.measures || []
    state.lastSync = c.lastSync || null
  }
  state.pending = await idb.count('outbox')
  sortAll(); emit()
}

// ---------- Modifiche locali + coda ----------------------------------
function applyLocal(op) {
  if (op.op === 'upsert') {
    const arr = state[KEY[op.table]]
    const rows = Array.isArray(op.row) ? op.row : [op.row]
    for (const row of rows) {
      let i = arr.findIndex((r) => r.id === row.id)
      if (i < 0 && op.table === 'wear_log') i = arr.findIndex((r) => r.item_id === row.item_id && r.worn_on === row.worn_on)
      if (i >= 0) arr[i] = { ...arr[i], ...row }
      else arr.push({ created_at: new Date().toISOString(), ...row })
    }
  } else if (op.op === 'update') {
    const arr = state[KEY[op.table]]
    const i = arr.findIndex((r) => r.id === op.id)
    if (i >= 0) arr[i] = { ...arr[i], ...op.row }
  } else if (op.op === 'delete') {
    const ids = new Set(Array.isArray(op.id) ? op.id : [op.id])
    state[KEY[op.table]] = state[KEY[op.table]].filter((r) => !ids.has(r.id))
    if (op.table === 'items') state.wearLog = state.wearLog.filter((w) => !ids.has(w.item_id))
  }
}

async function enqueue(op) {
  applyLocal(op)
  sortAll()
  await idb.put('outbox', { ...op, attempts: 0, at: Date.now() })
  state.pending = await idb.count('outbox')
  await saveCache()
  emit()
  flush()
}

export const upsert = (table, row, opts = {}) => {
  const withUser = (r) => ({ ...r, user_id: state.user?.id })
  return enqueue({ op: 'upsert', table, row: Array.isArray(row) ? row.map(withUser) : withUser(row), ...opts })
}
export const remove = (table, id) => enqueue({ op: 'delete', table, id })
// modifica parziale di una riga esistente (l'upsert richiederebbe tutti i campi obbligatori)
export const patch = (table, id, row) => enqueue({ op: 'update', table, id, row })

export async function upload(path, blob) {
  await idb.put('img', blob, path)
  await idb.put('outbox', { op: 'upload', path, attempts: 0, at: Date.now() })
  state.pending = await idb.count('outbox'); emit()
}
export async function removeFiles(paths) {
  paths = paths.filter(Boolean)
  if (!paths.length) return
  for (const p of paths) await idb.del('img', p)
  await idb.put('outbox', { op: 'removeFiles', paths, attempts: 0, at: Date.now() })
  state.pending = await idb.count('outbox'); emit()
}

// ---------- Invio della coda -----------------------------------------
const isNetwork = (err, status) =>
  !navigator.onLine || status === 0 || status === 408 || status === 429 || (status >= 500) ||
  /fetch|network|load failed|timed? ?out|abort/i.test(err?.message || '')

let flushing = null
export function flush() {
  if (!flushing) flushing = doFlush().finally(() => { flushing = null })
  return flushing
}

async function runOp(op) {
  if (op.op === 'upsert') {
    const q = sb.from(op.table).upsert(op.row, op.onConflict ? { onConflict: op.onConflict, ignoreDuplicates: !!op.ignoreDuplicates } : undefined)
    const { error, status } = await q
    return { error, status }
  }
  if (op.op === 'update') {
    const { error, status } = await sb.from(op.table).update(op.row).eq('id', op.id)
    return { error, status }
  }
  if (op.op === 'delete') {
    const ids = Array.isArray(op.id) ? op.id : [op.id]
    const { error, status } = await sb.from(op.table).delete().in('id', ids)
    return { error, status }
  }
  if (op.op === 'upload') {
    const blob = await idb.get('img', op.path)
    if (!blob) return { error: null } // foto già rimossa: niente da caricare
    const { error } = await sb.storage.from(BUCKET).upload(op.path, blob, { upsert: true, contentType: blob.type || 'image/jpeg', cacheControl: '31536000' })
    return { error, status: error?.statusCode ? Number(error.statusCode) : (error ? 0 : 200) }
  }
  if (op.op === 'removeFiles') {
    const { error } = await sb.storage.from(BUCKET).remove(op.paths)
    return { error, status: error?.statusCode ? Number(error.statusCode) : (error ? 0 : 200) }
  }
  return { error: null }
}

async function doFlush() {
  if (!sb || !state.user || !navigator.onLine) return
  const ops = (await idb.all('outbox')).sort((a, b) => a.seq - b.seq)
  for (const op of ops) {
    let res
    try { res = await runOp(op) } catch (e) { res = { error: e, status: 0 } }
    if (!res.error) { await idb.del('outbox', op.seq); continue }
    if (res.status === 401 || (res.status === 403 && /jwt|token/i.test(res.error.message || ''))) break // sessione da rinnovare
    if (isNetwork(res.error, res.status)) break // riprova più tardi, mantenendo l'ordine
    op.attempts = (op.attempts || 0) + 1
    if (op.attempts >= 3) {
      state.errors.unshift({ at: Date.now(), what: describe(op), message: res.error.message || String(res.error) })
      state.errors = state.errors.slice(0, 20)
      await idb.del('outbox', op.seq)
    } else await idb.put('outbox', op)
    break
  }
  state.pending = await idb.count('outbox')
  emit()
}

function describe(op) {
  if (op.op === 'upload') return 'Caricamento foto'
  if (op.op === 'removeFiles') return 'Eliminazione foto'
  return `${op.op === 'delete' ? 'Eliminazione' : 'Salvataggio'} in ${op.table}`
}

// ---------- Scaricamento completo ------------------------------------
export async function pull() {
  if (!sb || !state.user || !navigator.onLine) return false
  const res = await Promise.all(TABLES.map((t) => sb.from(t).select('*').limit(10000)))
  const bad = res.find((r) => r.error)
  if (bad) throw bad.error
  state.items = res[0].data; state.wearLog = res[1].data; state.measures = res[2].data
  // le modifiche non ancora inviate restano visibili
  for (const op of await idb.all('outbox')) applyLocal(op)
  state.lastSync = new Date().toISOString()
  sortAll()
  await saveCache()
  emit()
  return true
}

export async function sync() {
  if (state.syncing) return
  state.syncing = true; emit()
  try { await flush(); await pull() } catch (e) { console.warn('sync', e) } finally { state.syncing = false; emit() }
}

export async function clearLocal() {
  await idb.clear('kv'); await idb.clear('outbox'); await idb.clear('img'); await idb.clear('batch').catch(() => {})
  state.items = []; state.wearLog = []; state.measures = []; state.pending = 0; state.lastSync = null
  emit()
}

window.addEventListener('online', () => { state.online = true; emit(); sync() })
window.addEventListener('offline', () => { state.online = false; emit() })
// con rete instabile riprova da sola ogni minuto finché ci sono modifiche in coda
setInterval(() => { if (state.user && state.pending && navigator.onLine) flush() }, 60000)
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.user) sync() })

export const uuid = () => crypto.randomUUID()
export const latestMeasures = () => state.measures[0] || null
