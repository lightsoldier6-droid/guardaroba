// IndexedDB minimale: kv (cache dati), outbox (modifiche da inviare), img (foto in cache)
const DB = 'guardaroba', VER = 1
let dbp = null

function open() {
  if (dbp) return dbp
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, VER)
    r.onupgradeneeded = () => {
      const db = r.result
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv')
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true })
      if (!db.objectStoreNames.contains('img')) db.createObjectStore('img')
    }
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
  return dbp
}

async function tx(store, mode, fn) {
  const db = await open()
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode)
    const s = t.objectStore(store)
    const out = fn(s)
    t.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

export const get = (store, key) => tx(store, 'readonly', (s) => s.get(key))
export const put = (store, value, key) => tx(store, 'readwrite', (s) => (key === undefined ? s.put(value) : s.put(value, key)))
export const del = (store, key) => tx(store, 'readwrite', (s) => s.delete(key))
export const all = (store) => tx(store, 'readonly', (s) => s.getAll())
export const clear = (store) => tx(store, 'readwrite', (s) => s.clear())
export const count = (store) => tx(store, 'readonly', (s) => s.count())
