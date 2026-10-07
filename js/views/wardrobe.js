import { h, put, add, icon, toast, thumb, fmtDate } from '../ui.js'
import { state, upsert, patch, remove, removeFiles, uuid } from '../store.js'
import { CATEGORIES, COLORS, FABRICS, SEASONS, OCCASIONS, FIT_FEEL, WARMTH, SIZE_SYSTEMS, MATCH_LEVEL, compositionToText } from '../taxonomy.js'
import { itemName, slotOf, toDay, daysBetween, wearStats } from '../outfit.js'
import { hydrate } from '../images.js'
import { dropOwnPhotos } from '../itemsave.js'
import * as batch from '../batch.js'

const eur = (n) => Number(n).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return 'il sito' } }
// l'altra foto (quella che non fa da copertina), se c'è
function otherPhoto(it) {
  const hasOwn = !!(it.photo_path || it.thumb_path), hasCat = !!(it.catalog_photo_path || it.catalog_thumb_path)
  if (!hasOwn || !hasCat) return null
  const catIsCover = it.cover === 'catalog'
  const path = catIsCover ? it.photo_path || it.thumb_path : it.catalog_photo_path || it.catalog_thumb_path
  return h('details', { class: 'labelphoto' }, h('summary', null, catIsCover ? 'La tua foto' : 'Foto di catalogo'), thumb({ thumb_path: path }, 'big'))
}

// ---------- Elenco e filtri ------------------------------------------
const SLOT_TABS = { all: 'Tutto', top: 'Sopra', mid: 'Strati', jacket: 'Giacche', suit: 'Completi', outer: 'Capispalla', bottom: 'Sotto', shoes: 'Scarpe', belt: 'Cinture' }
const SLOT_ORDER = ['top', 'mid', 'jacket', 'suit', 'outer', 'bottom', 'shoes', 'belt']
const USE = { never: 'Mai indossati', idle: 'Fermi da 30+ giorni', recent: 'Indossati negli ultimi 7 giorni' }
const SORTS = { type: 'Per tipo', recent: 'Ultimi aggiunti', name: 'Nome', least: 'Meno indossati', most: 'Più indossati' }
const LIST_KEYS = ['cats', 'colors', 'seasons', 'occasions', 'fabrics']
const F0 = () => ({ slot: 'all', cats: [], colors: [], seasons: [], occasions: [], fabrics: [], brand: '', use: '', sort: 'type' })
const STORE_KEY = 'guardaroba.filtri'
// i filtri restano tra un'apertura e l'altra dell'app (solo su questo telefono)
function loadFilters() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null')
    if (!s || typeof s !== 'object') return F0()
    const f = { ...F0(), ...s }
    for (const k of LIST_KEYS) if (!Array.isArray(f[k])) f[k] = []
    if (!SLOT_TABS[f.slot]) f.slot = 'all'
    if (!SORTS[f.sort]) f.sort = 'type'
    return f
  } catch { return F0() }
}
const saveFilters = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(f)) } catch { /* archiviazione non disponibile */ } }

let f = loadFilters(), query = '', showArchived = false, panelOpen = false
const activeCount = () => LIST_KEYS.filter((k) => k !== 'cats').reduce((n, k) => n + f[k].length, 0) + (f.brand ? 1 : 0) + (f.use ? 1 : 0)
const norm = (s) => String(s || '').trim().toLowerCase()
const occsOf = (it) => (it.occasions?.length ? it.occasions : ['casual']) // come negli outfit: senza occasioni vale casual

export const live = true
export const title = 'Armadio'

let refresh = null, bt = null
batch.onChange(() => { clearTimeout(bt); bt = setTimeout(() => refresh?.(), 80) })

export function render(root, { go, rerender }) {
  refresh = () => { if (/^#\/armadio$/.test(location.hash)) rerender() }
  const today = toDay(new Date())
  const stats = wearStats(state.wearLog)
  const idleDays = (it) => { const st = stats.get(it.id); return st?.last ? daysBetween(st.last, today) : Infinity }
  const q = norm(query)
  const pool = state.items.filter((i) => (showArchived ? i.archived : !i.archived))

  // skip: le sfaccettature da non applicare (per contare le opzioni di quel gruppo)
  const match = (it, skipArg = '') => {
    const skip = [].concat(skipArg)
    if (!skip.includes('slot') && f.slot !== 'all' && slotOf(it) !== f.slot) return false
    if (!skip.includes('cats') && f.cats.length && !f.cats.includes(it.category)) return false
    if (!skip.includes('colors') && f.colors.length && !f.colors.includes(it.color_primary)) return false
    if (!skip.includes('seasons') && f.seasons.length && it.seasons?.length && !f.seasons.some((s) => it.seasons.includes(s))) return false
    if (!skip.includes('occasions') && f.occasions.length && !f.occasions.some((o) => occsOf(it).includes(o))) return false
    if (!skip.includes('fabrics') && f.fabrics.length && !f.fabrics.includes(it.fabric)) return false
    if (!skip.includes('brand') && f.brand && norm(it.brand) !== f.brand) return false
    if (!skip.includes('use') && f.use) {
      const d = idleDays(it)
      if (f.use === 'never' && d !== Infinity) return false
      if (f.use === 'idle' && d < 30) return false
      if (f.use === 'recent' && d > 7) return false
    }
    if (q && ![it.name, it.brand, CATEGORIES[it.category]?.label, COLORS[it.color_primary]?.label, FABRICS[it.fabric]?.label, it.notes, it.article_code]
      .some((s) => s && norm(s).includes(q))) return false
    return true
  }
  const counts = (skip, keyOf) => {
    const m = new Map()
    for (const it of pool) if (match(it, skip)) for (const k of [].concat(keyOf(it))) if (k) m.set(k, (m.get(k) || 0) + 1)
    return m
  }
  const list = pool.filter((it) => match(it))
  const set = (patchF) => { f = { ...f, ...patchF }; saveFilters(); rerender() }
  const toggle = (k, v) => set({ [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] })

  // ---- ordinamento
  const catIdx = Object.fromEntries(Object.keys(CATEGORIES).map((k, i) => [k, i]))
  const colIdx = Object.fromEntries(Object.keys(COLORS).map((k, i) => [k, i]))
  const byType = (a, b) => (catIdx[a.category] ?? 99) - (catIdx[b.category] ?? 99) || (colIdx[a.color_primary] ?? 99) - (colIdx[b.color_primary] ?? 99) || itemName(a).localeCompare(itemName(b), 'it')
  const worn = (it) => stats.get(it.id)?.count || 0
  const sorters = {
    type: byType,
    recent: (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')),
    name: (a, b) => itemName(a).localeCompare(itemName(b), 'it'),
    least: (a, b) => worn(a) - worn(b) || idleDays(b) - idleDays(a),
    most: (a, b) => worn(b) - worn(a),
  }
  list.sort(sorters[f.sort] || byType)

  const search = h('input', { type: 'search', placeholder: 'Cerca marca, nome, colore, codice', value: query, enterkeyhint: 'search',
    oninput: (e) => { query = e.target.value; clearTimeout(search.t); search.t = setTimeout(() => { rerender(); document.querySelector('.view input[type=search]')?.focus() }, 250) } })
  const nActive = activeCount()

  // ---- schede per tipo (con il numero di capi) e, dentro un tipo, le categorie
  // le categorie sono una suddivisione del tipo: non contano per le schede dei tipi
  const slotCounts = counts(['slot', 'cats'], (it) => slotOf(it))
  slotCounts.set('all', pool.filter((it) => match(it, ['slot', 'cats'])).length)
  const slotTabs = h('div', { class: 'tabs-mini', role: 'tablist' }, Object.entries(SLOT_TABS)
    .filter(([k]) => k === 'all' || k === f.slot || slotCounts.get(k))
    .map(([k, v]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(f.slot === k), class: 'choice' + (f.slot === k ? ' on' : ''),
      onclick: () => set({ slot: k, cats: [] }) }, v, h('span', { class: 'n' }, slotCounts.get(k) || 0))))
  let catRow = null
  if (f.slot !== 'all') {
    const cc = counts('cats', (it) => it.category)
    const cats = Object.keys(CATEGORIES).filter((k) => cc.get(k) || f.cats.includes(k))
    if (cats.length > 1 || f.cats.length) catRow = h('div', { class: 'tabs-mini sub' }, cats.map((k) =>
      h('button', { type: 'button', class: 'choice' + (f.cats.includes(k) ? ' on' : ''), onclick: () => toggle('cats', k) }, CATEGORIES[k].label, h('span', { class: 'n' }, cc.get(k) || 0))))
  }

  // ---- pannello filtri
  const chipGroup = (title, k, dict, cnt) => {
    const keys = Object.keys(dict).filter((v) => cnt.get(v) || f[k].includes(v))
    if (!keys.length) return null
    return h('div', { class: 'fgroup' }, h('h4', null, title), h('div', { class: 'choices' }, keys.map((v) =>
      h('button', { type: 'button', class: 'choice fchip' + (f[k].includes(v) ? ' on' : ''), 'aria-pressed': String(f[k].includes(v)), onclick: () => toggle(k, v) },
        typeof dict[v] === 'string' ? dict[v] : dict[v].label, h('span', { class: 'n' }, cnt.get(v) || 0)))))
  }
  const panel = () => {
    const colCnt = counts('colors', (it) => it.color_primary)
    const colors = Object.keys(COLORS).filter((c) => colCnt.get(c) || f.colors.includes(c))
    const brandCnt = new Map(), brandName = new Map()
    for (const it of pool) if (it.brand && match(it, 'brand')) { const k = norm(it.brand); brandCnt.set(k, (brandCnt.get(k) || 0) + 1); if (!brandName.has(k)) brandName.set(k, it.brand.trim()) }
    const brands = [...brandName.keys()].sort((a, b) => a.localeCompare(b, 'it'))
    const useCnt = new Map(Object.keys(USE).map((u) => [u, pool.filter((it) => match(it, 'use') && (u === 'never' ? idleDays(it) === Infinity : u === 'idle' ? idleDays(it) >= 30 : idleDays(it) <= 7)).length]))
    return h('div', { class: 'fpanel', id: 'fpanel' },
      colors.length ? h('div', { class: 'fgroup' }, h('h4', null, 'Colore'), h('div', { class: 'swatches' }, colors.map((c) =>
        h('button', { type: 'button', class: 'sw' + (f.colors.includes(c) ? ' on' : ''), 'aria-pressed': String(f.colors.includes(c)), onclick: () => toggle('colors', c) },
          h('i', { style: { background: COLORS[c].hex } }), h('span', null, `${COLORS[c].label} ${colCnt.get(c) || 0}`))))) : null,
      chipGroup('Stagione', 'seasons', SEASONS, counts('seasons', (it) => (it.seasons?.length ? it.seasons : Object.keys(SEASONS)))),
      chipGroup('Occasione', 'occasions', OCCASIONS, counts('occasions', occsOf)),
      chipGroup('Tessuto', 'fabrics', FABRICS, counts('fabrics', (it) => it.fabric)),
      brands.length ? h('div', { class: 'fgroup' }, h('h4', null, 'Marca'),
        h('select', { onchange: (e) => set({ brand: e.target.value }) }, h('option', { value: '' }, 'Tutte le marche'),
          brands.map((b) => h('option', { value: b, selected: f.brand === b }, `${brandName.get(b)} (${brandCnt.get(b)})`)))) : null,
      h('div', { class: 'fgroup' }, h('h4', null, 'Utilizzo'), h('div', { class: 'choices' }, Object.entries(USE).map(([k, v]) =>
        h('button', { type: 'button', class: 'choice fchip' + (f.use === k ? ' on' : ''), 'aria-pressed': String(f.use === k), onclick: () => set({ use: f.use === k ? '' : k }) }, v, h('span', { class: 'n' }, useCnt.get(k)))))),
      h('div', { class: 'fgroup' }, h('h4', null, 'Ordina'), h('div', { class: 'choices' }, Object.entries(SORTS).map(([k, v]) =>
        h('button', { type: 'button', class: 'choice fchip' + (f.sort === k ? ' on' : ''), 'aria-pressed': String(f.sort === k), onclick: () => set({ sort: k }) }, v)))),
      h('div', { class: 'fpanel-foot' },
        nActive ? h('button', { type: 'button', class: 'link', onclick: () => set({ ...F0(), slot: f.slot, sort: f.sort }) }, 'Azzera filtri') : h('span'),
        h('button', { type: 'button', class: 'btn', onclick: () => { panelOpen = false; rerender() } }, `Mostra ${list.length} ${list.length === 1 ? 'capo' : 'capi'}`)))
  }

  // ---- filtri attivi, da togliere uno per uno
  const active = [
    ...f.colors.map((v) => [COLORS[v]?.label, () => toggle('colors', v)]),
    ...f.seasons.map((v) => [SEASONS[v], () => toggle('seasons', v)]),
    ...f.occasions.map((v) => [OCCASIONS[v], () => toggle('occasions', v)]),
    ...f.fabrics.map((v) => [FABRICS[v]?.label, () => toggle('fabrics', v)]),
    ...(f.brand ? [[pool.find((i) => norm(i.brand) === f.brand)?.brand?.trim() || f.brand, () => set({ brand: '' })]] : []),
    ...(f.use ? [[USE[f.use], () => set({ use: '' })]] : []),
  ].filter(([l]) => l)
  const activeRow = active.length && !panelOpen ? h('div', { class: 'active-f' }, active.map(([l, off]) =>
    h('button', { type: 'button', class: 'achip', 'aria-label': `Togli il filtro ${l}`, onclick: off }, l, h('span', { 'aria-hidden': 'true' }, '×'))),
    h('button', { type: 'button', class: 'link', onclick: () => set({ ...F0(), slot: f.slot, sort: f.sort }) }, 'Azzera')) : null

  // ---- griglia: per tipo con le intestazioni, altrimenti un elenco unico
  const cell = (it) => h('a', { class: 'cell', href: `#/capo/${it.id}` }, thumb(it), h('span', { class: 'cell-n' }, itemName(it)), it.brand ? h('span', { class: 'cell-b' }, it.brand) : null)
  let body
  if (!list.length) {
    body = h('div', { class: 'empty' }, h('h3', null, state.items.length ? 'Nessun capo con questi filtri' : 'L’armadio è vuoto'),
      state.items.length && (nActive || q || f.slot !== 'all')
        ? h('button', { class: 'btn ghost', onclick: () => { query = ''; set({ ...F0(), sort: f.sort }) } }, 'Togli tutti i filtri')
        : h('p', null, 'Basta fotografare l’etichetta: l’AI legge i dati e cerca il capo online, con la foto di catalogo.'))
  } else if (f.sort === 'type' && f.slot === 'all') {
    body = SLOT_ORDER.map((s) => {
      const its = list.filter((it) => slotOf(it) === s)
      return its.length ? h('section', { class: 'grp' }, h('h3', { class: 'grp-h' }, SLOT_TABS[s], h('span', null, its.length)), h('div', { class: 'grid' }, its.map(cell))) : null
    })
  } else body = h('div', { class: 'grid' }, list.map(cell))

  const toReview = batch.bstate.list.filter((e) => !['queued', 'working'].includes(batch.levelOf(e))).length
  const inQueue = batch.bstate.list.length - toReview
  add(root,
    h('div', { class: 'toolbar filterbar' }, search,
      h('button', { type: 'button', class: 'fbtn' + (panelOpen ? ' on' : ''), 'aria-expanded': String(panelOpen), 'aria-controls': 'fpanel', onclick: () => { panelOpen = !panelOpen; rerender() } },
        h('span', { html: icon.filter }), 'Filtri', nActive ? h('b', { class: 'badge' }, nActive) : null)),
    h('a', { class: 'batchlink', href: '#/raffica' }, h('span', { html: icon.camera }),
      h('span', null, h('b', null, 'Etichette a raffica'), h('small', null, toReview ? `${toReview} da rivedere` + (inQueue ? `, ${inQueue} in lavorazione` : '') : inQueue ? `${inQueue} in lavorazione` : 'Cataloga molti capi di fila, solo dalle etichette'))),
    slotTabs, catRow,
    panelOpen ? panel() : null,
    activeRow,
    h('p', { class: 'count' }, `${list.length} ${list.length === 1 ? 'capo' : 'capi'}${showArchived ? ' archiviati' : ''}${f.sort !== 'type' ? ` · ${SORTS[f.sort].toLowerCase()}` : ''}`,
      h('button', { class: 'link', onclick: () => { showArchived = !showArchived; rerender() } }, showArchived ? 'Mostra attivi' : 'Archiviati')),
    body,
    h('button', { class: 'fab', 'aria-label': 'Aggiungi un capo', onclick: () => go('#/capo/nuovo'), html: icon.plus }),
  )
  hydrate(root)
}

// ---------- Scheda del capo ------------------------------------------
export function renderItem(root, { go, params }) {
  const it = state.items.find((i) => i.id === params.id)
  if (!it) { add(root, h('div', { class: 'empty' }, h('h3', null, 'Capo non trovato'), h('button', { class: 'btn', onclick: () => go('#/armadio') }, 'Torna all’armadio'))); return }
  const st = wearStats(state.wearLog).get(it.id)
  const today = toDay(new Date())
  const cat = CATEGORIES[it.category]

  const rows = [
    ['Taglia', it.size_label ? `${it.size_label} ${SIZE_SYSTEMS[it.size_system] || ''}`.trim() + ((it.size_alt || []).length ? ` (${it.size_alt.map((s) => `${s.label} ${SIZE_SYSTEMS[s.system]}`).join(', ')})` : '') : null],
    ['Vestibilità', it.fit],
    ['Come ti veste', FIT_FEEL[it.fit_feel]],
    ['Tessuto', FABRICS[it.fabric]?.label],
    ['Composizione', compositionToText(it.composition)],
    ['Peso', WARMTH[it.warmth]],
    ['Stagioni', (it.seasons || []).map((s) => SEASONS[s]).join(', ')],
    ['Occasioni', (it.occasions || []).map((s) => OCCASIONS[s]).join(', ')],
    ['Prezzo', it.price != null ? eur(it.price) : null],
    ['Prezzo di listino', it.list_price != null && Number(it.list_price) !== Number(it.price) ? eur(it.list_price) : null],
    ['Codice', [it.article_code, it.color_code].filter(Boolean).join(' · ') || null],
    ['Codice a barre', it.ean],
  ].filter(([, v]) => v)

  const wornToday = state.wearLog.some((w) => w.item_id === it.id && w.worn_on === today)

  add(root, 
    h('div', { class: 'detail-photo' }, thumb(it, 'big')),
    h('div', { class: 'detail-head' },
      h('h2', null, itemName(it)),
      h('p', { class: 'muted' }, [it.brand, cat?.label].filter(Boolean).join(', '),
        h('span', { class: 'dot', style: { background: COLORS[it.color_primary]?.hex } }),
        ...(it.colors_secondary || []).map((c) => h('span', { class: 'dot', style: { background: COLORS[c]?.hex } })))),
    h('div', { class: 'carelabel label' },
      rows.map(([k, v]) => h('div', { class: 'cl-row' }, h('span', null, k), h('b', null, v))),
      (it.care || []).length ? h('ul', { class: 'cl-care' }, it.care.map((c) => h('li', null, c))) : null),
    h('p', { class: 'wear' }, st ? `Indossato ${st.count} ${st.count === 1 ? 'volta' : 'volte'}, l’ultima ${daysBetween(st.last, today) === 0 ? 'oggi' : `${fmtDate(st.last)} (${daysBetween(st.last, today)} giorni fa)`}` : 'Non ancora indossato'),
    it.source_url ? h('p', { class: 'source' }, h('span', { class: 'ai-tag web' }, 'dal web'), ' ', MATCH_LEVEL[it.match_level] || 'Dati presi online', '. ',
      h('a', { href: it.source_url, target: '_blank', rel: 'noopener noreferrer' }, `Apri la pagina su ${hostOf(it.source_url)}`)) : null,
    otherPhoto(it),
    it.label_photo_path ? h('details', { class: 'labelphoto' }, h('summary', null, 'Foto dell’etichetta'), thumb({ thumb_path: it.label_photo_path }, 'big')) : null,
    it.notes ? h('p', { class: 'notes' }, it.notes) : null,
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: () => go(`#/capo/${it.id}/modifica`) }, 'Modifica'),
      it.photo_path || it.thumb_path ? h('button', { class: 'btn ghost', onclick: async () => {
        const repl = it.catalog_photo_path ? 'la foto di catalogo' : 'la sagoma stilizzata'
        if (!confirm(`Eliminare la tua foto di questo capo? Al suo posto vedrai ${repl}. L’etichetta resta.`)) return
        await dropOwnPhotos([it]); toast('Foto eliminata')
      } }, 'Togli la mia foto') : null,
      wornToday ? null : h('button', { class: 'btn ghost', onclick: () => {
        upsert('wear_log', { id: uuid(), item_id: it.id, worn_on: today }, { onConflict: 'item_id,worn_on', ignoreDuplicates: true })
        toast('Segnato come indossato oggi')
      } }, 'Indossato oggi'),
      h('button', { class: 'btn ghost', onclick: () => { patch('items', it.id, { archived: !it.archived }); toast(it.archived ? 'Riportato nell’armadio' : 'Archiviato: non comparirà negli outfit') } }, it.archived ? 'Ripristina' : 'Archivia'),
      h('button', { class: 'btn danger', onclick: async () => {
        if (!confirm(`Eliminare definitivamente “${itemName(it)}”, le sue foto e il suo storico?`)) return
        await removeFiles([it.photo_path, it.thumb_path, it.label_photo_path, it.catalog_photo_path, it.catalog_thumb_path])
        await remove('items', it.id)
        toast('Capo eliminato'); go('#/armadio')
      } }, 'Elimina')),
  )
  hydrate(root)
}
