// Modalità a raffica: fotografi molte etichette di fila, le letture e le ricerche vanno in coda
// (anche offline) e poi le rivedi in una lista ordinata per livello di corrispondenza.
// La coda vive in IndexedDB sul telefono: non si perde chiudendo l'app, parte quando c'è rete.
import * as idb from './idb.js'
import { analyze, lookup, canLookup, fetchImage } from './ai.js'
import { toBase64, prepareCatalog } from './images.js'
import { webFields, mergeInto } from './webmatch.js'
import { saveItem } from './itemsave.js'
import { uuid } from './store.js'
import { COLORS } from './taxonomy.js'

export const bstate = { list: [], running: false, loaded: false }
const listeners = new Set()
export const onChange = (fn) => (listeners.add(fn), () => listeners.delete(fn))
const emit = () => listeners.forEach((fn) => { try { fn(bstate) } catch (e) { console.error(e) } })

export async function load() {
  bstate.list = ((await idb.all('batch').catch(() => [])) || []).sort((a, b) => a.created - b.created)
  bstate.loaded = true
  emit()
}
async function save(entry) { await idb.put('batch', entry); await load() }

// prepared: [{ full, ai }] dalle foto delle etichette
export async function addLabels(prepared) {
  const now = Date.now()
  for (const [i, p] of prepared.entries()) await idb.put('batch', { id: uuid(), created: now + i, label: { full: p.full, ai: p.ai }, status: 'queued' })
  await load()
  run()
}
export async function remove(id) { await idb.del('batch', id); await load() }
export async function retry(id) {
  const e = bstate.list.find((x) => x.id === id)
  if (e) { e.status = 'queued'; e.error = null; await save(e); run() }
}

// Livello per la revisione: exact | model | possible | none | queued | working | error
export function levelOf(e) {
  if (e.status === 'error') return 'error'
  if (e.status === 'queued') return 'queued'
  if (e.status !== 'ready') return 'working'
  return e.web?.level || 'none'
}

// Bozza del capo da una voce: dati dell'etichetta, più quelli del web se la corrispondenza è certa
export function draftOf(e) {
  const fields = { colors_secondary: [], composition: [], care: [], seasons: [], occasions: [], size_alt: [], ...(e.fields || {}) }
  for (const k of ['article_code', 'color_code', 'ean']) if (e.codes?.[k]) fields[k] = e.codes[k]
  const aiFilled = Object.keys(fields).filter((k) => fields[k] != null && !(Array.isArray(fields[k]) && !fields[k].length))
  let webFilled = [], catalogUrl = null, picked = null
  const c = e.web?.candidates?.[0]
  if (e.web?.level === 'exact' && c) {
    const w = webFields(c, c.variant, { brand: fields.brand, matchLevel: 'exact' })
    webFilled = mergeInto(fields, w.fields)
    catalogUrl = w.imageUrl
    picked = { ci: 0, vi: c.variant, level: 'exact' }
  }
  return { fields, aiFilled, webFilled, catalogUrl, picked }
}

let wake = null
export async function run() {
  if (bstate.running) return
  bstate.running = true; emit()
  try {
    if (!bstate.loaded) await load()
    while (navigator.onLine) {
      const e = bstate.list.find((x) => x.status === 'queued' || x.status === 'reading' || x.status === 'searching')
      if (!e) break
      try {
        if (!e.fields) {
          e.status = 'reading'; await save(e)
          const r = await analyze({ photo: null, label: await toBase64(e.label.ai) })
          e.fields = r.fields; e.codes = r.codes; e.readable = r.readable
        }
        e.status = 'searching'; await save(e)
        const q = { brand: e.fields.brand || '', category: e.fields.category || '', ...Object.fromEntries(Object.entries(e.codes || {}).map(([k, v]) => [k, v || ''])) }
        if (!q.color_name && e.fields.color_primary) q.color_name = COLORS[e.fields.color_primary]?.label.toLowerCase() || ''
        e.web = canLookup(q) ? await lookup(q) : { level: 'none', candidates: [], note: 'Codici o marca non leggibili' }
        e.status = 'ready'; await save(e)
      } catch (err) {
        if (!navigator.onLine || /offline|connessione/i.test(err.message)) { e.status = 'queued'; await save(e); break }
        e.status = 'error'; e.error = err.message; await save(e)
      }
    }
  } finally {
    bstate.running = false; emit()
  }
}

// Conferma in blocco delle corrispondenze certe. Salta (e lascia in lista) le voci senza categoria o colore.
export async function confirmExact(onProgress) {
  const list = bstate.list.filter((e) => levelOf(e) === 'exact')
  let saved = 0, skipped = 0
  for (const e of list) {
    const d = draftOf(e)
    if (!d.fields.category || !d.fields.color_primary) { skipped++; continue }
    let catalog = null
    if (d.catalogUrl) { try { catalog = await prepareCatalog(await fetchImage(d.catalogUrl)) } catch { /* senza foto di catalogo */ } }
    await saveItem(d.fields, { label: { full: e.label.full }, catalog })
    await idb.del('batch', e.id)
    saved++
    onProgress?.(saved, list.length)
  }
  await load()
  return { saved, skipped }
}

window.addEventListener('online', () => { clearTimeout(wake); wake = setTimeout(run, 1500) })
