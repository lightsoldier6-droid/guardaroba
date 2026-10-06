import { h, put, add, icon, toast, thumb, fmtDate } from '../ui.js'
import { state, upsert, patch, remove, removeFiles, uuid } from '../store.js'
import { CATEGORIES, COLORS, FABRICS, SEASONS, OCCASIONS, FIT_FEEL, WARMTH, SIZE_SYSTEMS, MATCH_LEVEL, compositionToText } from '../taxonomy.js'
import { itemName, slotOf, toDay, daysBetween, wearStats } from '../outfit.js'
import { hydrate } from '../images.js'
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

const FILTERS = { all: 'Tutto', top: 'Sopra', mid: 'Strati', jacket: 'Giacche', outer: 'Capispalla', bottom: 'Sotto', shoes: 'Scarpe' }
let filter = 'all', query = '', showArchived = false

export const live = true
export const title = 'Armadio'

let refresh = null, bt = null
batch.onChange(() => { clearTimeout(bt); bt = setTimeout(() => refresh?.(), 80) })

export function render(root, { go, rerender }) {
  refresh = () => { if (/^#\/armadio$/.test(location.hash)) rerender() }
  const q = query.trim().toLowerCase()
  const list = state.items.filter((i) => (showArchived ? i.archived : !i.archived)
    && (filter === 'all' || slotOf(i) === filter)
    && (!q || [i.name, i.brand, CATEGORIES[i.category]?.label, COLORS[i.color_primary]?.label, FABRICS[i.fabric]?.label].some((s) => s?.toLowerCase().includes(q))))

  const search = h('input', { type: 'search', placeholder: 'Cerca per marca, nome, colore, tessuto', value: query, enterkeyhint: 'search',
    oninput: (e) => { query = e.target.value; clearTimeout(search.t); search.t = setTimeout(() => { rerender(); document.querySelector('.view input[type=search]')?.focus() }, 250) } })

  const toReview = batch.bstate.list.filter((e) => !['queued', 'working'].includes(batch.levelOf(e))).length
  const inQueue = batch.bstate.list.length - toReview
  add(root, 
    h('div', { class: 'toolbar' }, search),
    h('a', { class: 'batchlink', href: '#/raffica' }, h('span', { html: icon.camera }),
      h('span', null, h('b', null, 'Etichette a raffica'), h('small', null, toReview ? `${toReview} da rivedere` + (inQueue ? `, ${inQueue} in lavorazione` : '') : inQueue ? `${inQueue} in lavorazione` : 'Cataloga molti capi di fila, solo dalle etichette'))),
    h('div', { class: 'tabs-mini', role: 'tablist' }, Object.entries(FILTERS).map(([k, v]) =>
      h('button', { type: 'button', class: 'choice' + (filter === k ? ' on' : ''), onclick: () => { filter = k; rerender() } }, v))),
    h('p', { class: 'count' }, `${list.length} ${list.length === 1 ? 'capo' : 'capi'}${showArchived ? ' archiviati' : ''}`,
      h('button', { class: 'link', onclick: () => { showArchived = !showArchived; rerender() } }, showArchived ? 'Mostra attivi' : 'Archiviati')),
    list.length
      ? h('div', { class: 'grid' }, list.map((it) => h('a', { class: 'cell', href: `#/capo/${it.id}` }, thumb(it), h('span', { class: 'cell-n' }, itemName(it)), it.brand ? h('span', { class: 'cell-b' }, it.brand) : null)))
      : h('div', { class: 'empty' }, h('h3', null, state.items.length ? 'Nessun capo con questi filtri' : 'L’armadio è vuoto'),
          h('p', null, 'Basta fotografare l’etichetta: l’AI legge i dati e cerca il capo online, con la foto di catalogo.')),
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
