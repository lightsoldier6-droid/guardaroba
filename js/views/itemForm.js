import { h, put, add, keepAnchor, toast, choices, swatches, field, section, photoPicker } from '../ui.js'
import { state } from '../store.js'
import { saveItem } from '../itemsave.js'
import { CATEGORIES, COLORS, SEASONS, OCCASIONS, OCCASION_HINT, FIT_FEEL, WARMTH, SIZE_SYSTEMS, FABRICS, compositionToText, textToComposition, fabricFromComposition } from '../taxonomy.js'
import { prepare, prepareCatalog, toBase64, imageURL } from '../images.js'
import { analyze, lookup, fetchImage, canLookup, validEan } from '../ai.js'
import { webFields, mergeInto } from '../webmatch.js'
import { webPanel, newWebState } from './webPanel.js'
import * as batch from '../batch.js'

const ARRAYS = ['colors_secondary', 'composition', 'care', 'seasons', 'occasions', 'size_alt']

let handoff = null // dati passati da negozio o raffica
export function setDraft(d) { handoff = d }

export const title = 'Capo'

export function render(root, { go, params }) {
  const existing = params.id ? state.items.find((i) => i.id === params.id) : null
  if (params.id && !existing) { add(root, h('p', { class: 'empty' }, 'Capo non trovato')); return }
  const isNew = !existing
  let draft = existing ? structuredClone(existing) : { colors_secondary: [], composition: [], care: [], seasons: [], occasions: [], size_alt: [] }
  const pending = { photo: null, label: null, catalog: null }
  let labelCodes = { color_name: null, model_name: null } // letti in etichetta, servono solo alla ricerca
  let web = newWebState()
  const aiFilled = new Set(), webFilled = new Set()
  const aiValues = new Map() // ultimo valore messo dall'AI per campo: se non l'hai cambiato, una nuova lettura può aggiornarlo
  const webValues = new Map()
  let batchId = null, startCatalog = null
  if (isNew && handoff) {
    Object.assign(draft, handoff.fields || {})
    pending.photo = handoff.photo || null; pending.label = handoff.label || null; pending.catalog = handoff.catalog || null
    if (handoff.labelCodes) labelCodes = handoff.labelCodes
    for (const k of handoff.aiFilled || []) { aiFilled.add(k); aiValues.set(k, JSON.stringify(draft[k] ?? null)) }
    for (const k of handoff.webFilled || []) { webFilled.add(k); webValues.set(k, JSON.stringify(draft[k] ?? null)) }
    if (handoff.web) web = { ...newWebState(), ...handoff.web }
    batchId = handoff.batchId || null
    startCatalog = handoff.catalogUrl || null
    handoff = null
  }
  let aiBusy = false, aiMsg = ''
  let imgToken = 0

  const form = h('form', { class: 'itemform', novalidate: true, onsubmit: (e) => { e.preventDefault(); save() } })
  add(root, form)
  let ctl = {}

  const lookupQuery = () => ({
    brand: draft.brand || '', article_code: draft.article_code || '', color_code: draft.color_code || '', ean: draft.ean || '',
    color_name: labelCodes.color_name || COLORS[draft.color_primary]?.label.toLowerCase() || '', model_name: labelCodes.model_name || '', category: draft.category || '',
  })

  async function runAI() {
    if (aiBusy || (!pending.photo && !pending.label)) return
    collect()
    aiBusy = true; aiMsg = 'Lettura delle foto in corso…'; build()
    let res = null
    try {
      res = await analyze({
        photo: pending.photo ? await toBase64(pending.photo.ai) : null,
        label: pending.label ? await toBase64(pending.label.ai) : null,
      })
    } catch (e) { aiMsg = e.message }
    // prima conserva ciò che hai scelto mentre l'AI rispondeva, poi compila solo campi vuoti o lasciati com'erano
    collect()
    let codesChanged = false
    if (res) {
      for (const [k, v] of Object.entries(res.fields)) {
        const empty = v == null || (Array.isArray(v) && !v.length)
        const curEmpty = draft[k] == null || draft[k] === '' || (Array.isArray(draft[k]) && !draft[k].length)
        const untouchedAI = aiValues.has(k) && aiValues.get(k) === JSON.stringify(draft[k] ?? null)
        const untouchedWeb = webValues.has(k) && webValues.get(k) === JSON.stringify(draft[k] ?? null)
        if (!empty && (curEmpty || untouchedAI || untouchedWeb)) { draft[k] = v; aiFilled.add(k); aiValues.set(k, JSON.stringify(v)); webFilled.delete(k) }
      }
      for (const k of ['article_code', 'color_code', 'ean']) {
        const v = res.codes[k]
        if (v && (!draft[k] || (aiValues.get(k) === JSON.stringify(draft[k])))) {
          if (draft[k] !== v) codesChanged = true
          draft[k] = v; aiFilled.add(k); aiValues.set(k, JSON.stringify(v))
        }
      }
      labelCodes = { color_name: res.codes.color_name, model_name: res.codes.model_name }
      aiMsg = res.readable || !pending.label ? 'Dati letti: controlla i campi segnati e correggi se serve.' : 'Etichetta poco leggibile: controlla bene i campi.'
    }
    aiBusy = false
    // ricerca online automatica, solo se ci sono codici nuovi e non hai già scelto un risultato
    build() // il modulo mostra i dati letti prima di qualsiasi altra rilettura dei campi
    if (res && navigator.onLine && canLookup(lookupQuery()) && !web.picked && (web.status === 'idle' || codesChanged)) runLookup()
  }

  async function runLookup() {
    collect()
    if (!canLookup(lookupQuery())) { build(); toast('Servono la marca e un codice articolo o il nome del modello'); return }
    if (web.picked) unapplyWeb()
    web = { ...newWebState(), status: 'busy' }; build()
    try {
      const r = await lookup(lookupQuery())
      collect()
      web = { ...newWebState(), status: 'done', result: r }
      if (r.level === 'exact') return applyCandidate(0, r.candidates[0].variant, 'exact')
    } catch (e) {
      collect()
      web = { ...newWebState(), status: 'error', msg: e.message }
    }
    build()
  }

  // toglie i valori messi dal web che non hai cambiato, e la foto di catalogo
  function unapplyWeb() {
    for (const k of webFilled) {
      if (webValues.get(k) === JSON.stringify(draft[k] ?? null)) draft[k] = ARRAYS.includes(k) ? [] : null
    }
    webFilled.clear(); webValues.clear()
    draft.source_url = null; draft.match_level = null
    pending.catalog = null
    draft.catalog_photo_path = null; draft.catalog_thumb_path = null
    if (draft.cover === 'catalog') draft.cover = null
    imgToken++
  }

  function applyCandidate(ci, vi, level) {
    collect()
    const c = web.result?.candidates?.[ci]
    if (!c) return
    unapplyWeb()
    const { fields, imageUrl } = webFields(c, vi, { brand: draft.brand, matchLevel: level })
    const changed = mergeInto(draft, fields)
    for (const k of changed) { webFilled.add(k); webValues.set(k, JSON.stringify(draft[k] ?? null)) }
    web.picked = { ci, vi, level }; web.choosing = null; web.imgMsg = ''
    if (imageUrl) loadCatalog(imageUrl)
    else web.imgMsg = 'Nessuna foto di catalogo su questa pagina: aggiungi la tua se vuoi.'
    build()
  }

  async function loadCatalog(url) {
    const token = ++imgToken
    web.imgBusy = true
    try {
      const blob = await fetchImage(url)
      const prepared = await prepareCatalog(blob)
      if (token !== imgToken) return
      pending.catalog = prepared
      collect()
      if (!pending.photo && !draft.photo_path) draft.cover = 'catalog'
      web.imgMsg = ''
    } catch (e) {
      if (token !== imgToken) return
      collect()
      web.imgMsg = `Foto di catalogo non scaricabile (${e.message}). Puoi aggiungere la tua.`
    }
    web.imgBusy = false
    build()
  }

  const handlers = {
    search: () => runLookup(),
    apply: (ci, vi, level) => applyCandidate(ci, vi, level),
    choose: (ci) => { collect(); web.choosing = ci; web.picked = null; unapplyWeb(); build() },
    reject: () => { collect(); unapplyWeb(); web.picked = null; web.choosing = null; web.rejected = true; build() },
    none: () => { collect(); unapplyWeb(); web.picked = null; web.choosing = null; web.rejected = true; web.result = { level: 'none', candidates: [] }; web.noneByUser = true; build() },
  }

  function collect() {
    if (!ctl.category) return
    draft.category = ctl.category.value || null
    draft.kind = CATEGORIES[draft.category]?.kind || 'garment'
    draft.name = ctl.name.value.trim() || null
    draft.brand = ctl.brand.value.trim() || null
    draft.color_primary = ctl.color.value
    draft.colors_secondary = ctl.colors2.value.filter((c) => c !== draft.color_primary)
    draft.composition = textToComposition(ctl.composition.value)
    draft.fit = ctl.fit.value.trim() || null
    draft.size_label = ctl.size.value.trim() || null
    draft.size_system = ctl.system.value || null
    draft.care = ctl.care.value.split('\n').map((s) => s.trim()).filter(Boolean)
    draft.warmth = ctl.warmth.value ? Number(ctl.warmth.value) : null
    draft.seasons = ctl.seasons.value
    draft.occasions = ctl.occasions.value
    draft.fit_feel = ctl.fitFeel.value
    draft.fabric = ctl.fabric.value || fabricFromComposition(draft.composition)
    draft.price = numOrNull(ctl.price.value)
    draft.list_price = numOrNull(ctl.listPrice.value)
    draft.purchased_on = ctl.purchased.value || null
    draft.notes = ctl.notes.value.trim() || null
    draft.article_code = ctl.article.value.trim() || null
    draft.color_code = ctl.colorCode.value.trim() || null
    const ean = ctl.ean.value.replace(/\D/g, '')
    draft.ean = ean || null
    if (ctl.cover) draft.cover = ctl.cover.value || null
  }
  const numOrNull = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return v === '' || v == null || !isFinite(n) ? null : n }

  const mark = (k) => (aiFilled.has(k) ? h('em', { class: 'ai-tag' }, 'letto') : webFilled.has(k) ? h('em', { class: 'ai-tag web' }, 'dal web') : null)
  const lab = (text, k) => h('span', null, text, mark(k))

  function build() {
    const catSelect = h('select', { required: true },
      h('option', { value: '' }, 'Scegli…'),
      h('optgroup', { label: 'Abbigliamento' }, Object.entries(CATEGORIES).filter(([, c]) => c.kind === 'garment').map(([k, c]) => h('option', { value: k, selected: draft.category === k }, c.label))),
      h('optgroup', { label: 'Calzature' }, Object.entries(CATEGORIES).filter(([, c]) => c.kind === 'footwear').map(([k, c]) => h('option', { value: k, selected: draft.category === k }, c.label))))
    const sysSelect = h('select', null, h('option', { value: '' }, '—'), Object.entries(SIZE_SYSTEMS).map(([k, v]) => h('option', { value: k, selected: draft.size_system === k }, v)))
    const hasOwn = !!(pending.photo || draft.photo_path)
    const hasCat = !!(pending.catalog || draft.catalog_photo_path)
    ctl = {
      category: catSelect,
      name: h('input', { type: 'text', value: draft.name || '', placeholder: 'Facoltativo, es. Oxford del matrimonio', autocomplete: 'off' }),
      brand: h('input', { type: 'text', value: draft.brand || '', autocomplete: 'off', autocapitalize: 'words', list: 'brands',
        onchange: () => { if (web.status === 'idle' || web.status === 'error') { collect(); build() } } }),
      color: swatches(draft.color_primary, { onchange: () => ctl.colors2.refresh() }),
      colors2: null,
      composition: h('input', { type: 'text', value: compositionToText(draft.composition), placeholder: '98% cotone, 2% elastan',
        onchange: (e) => { const f = fabricFromComposition(textToComposition(e.target.value)); if (f && !ctl.fabric.value) ctl.fabric.value = f } }),
      fabric: choices(Object.fromEntries(Object.entries(FABRICS).map(([k, v]) => [k, v.label])), draft.fabric),
      fit: h('input', { type: 'text', value: draft.fit || '', list: 'fits', placeholder: 'slim, regular…' }),
      size: h('input', { type: 'text', value: draft.size_label || '', placeholder: '50, M, 41, W32 L34', autocapitalize: 'characters' }),
      system: sysSelect,
      article: h('input', { type: 'text', value: draft.article_code || '', placeholder: 'es. 503812', autocomplete: 'off', autocapitalize: 'characters' }),
      colorCode: h('input', { type: 'text', value: draft.color_code || '', placeholder: 'es. 410', autocomplete: 'off', autocapitalize: 'characters' }),
      ean: h('input', { type: 'text', inputmode: 'numeric', value: draft.ean || '', placeholder: '13 cifre sotto il codice a barre', autocomplete: 'off' }),
      care: h('textarea', { rows: 3, placeholder: 'Una istruzione per riga' }, (draft.care || []).join('\n')),
      warmth: choices(WARMTH, draft.warmth ? String(draft.warmth) : null),
      seasons: choices(SEASONS, draft.seasons, { multi: true }),
      occasions: choices(OCCASIONS, draft.occasions, { multi: true, hints: OCCASION_HINT }),
      fitFeel: choices(FIT_FEEL, draft.fit_feel),
      price: h('input', { type: 'text', inputmode: 'decimal', value: draft.price ?? '', placeholder: '€' }),
      listPrice: h('input', { type: 'text', inputmode: 'decimal', value: draft.list_price ?? '', placeholder: '€' }),
      purchased: h('input', { type: 'date', value: draft.purchased_on || '' }),
      notes: h('textarea', { rows: 2 }, draft.notes || ''),
      cover: hasOwn && hasCat ? choices({ own: 'La mia foto', catalog: 'Catalogo' }, draft.cover || 'own') : null,
    }
    ctl.colors2 = swatches(draft.colors_secondary, { multi: true, exclude: () => ctl.color.value })

    const brands = [...new Set(state.items.map((i) => i.brand).filter(Boolean))].sort()
    const photoPreview = pending.photo ? URL.createObjectURL(pending.photo.thumb) : null
    const labelPreview = pending.label ? URL.createObjectURL(pending.label.ai) : null
    const catalogPreview = pending.catalog ? URL.createObjectURL(pending.catalog.thumb) : null
    const pkLabel = photoPicker('Etichetta', { preview: labelPreview, onpick: async (f) => { const p = await prepare(f); pending.label = { full: p.full, ai: p.ai }; runAI() } })
    const pkPhoto = photoPicker('Foto del capo (facoltativa)', { preview: photoPreview, onpick: async (f) => { pending.photo = await prepare(f); runAI() } })
    if (!pending.photo && existing?.thumb_path) imageURL(existing.thumb_path).then((u) => pkPhoto.setPreview(u))
    if (!pending.label && existing?.label_photo_path) imageURL(existing.label_photo_path).then((u) => pkLabel.setPreview(u))

    keepAnchor(form, () => put(form,
      h('datalist', { id: 'brands' }, brands.map((b) => h('option', { value: b }))),
      h('datalist', { id: 'fits' }, ['slim', 'regular', 'comfort', 'tailored', 'oversize'].map((b) => h('option', { value: b }))),
      h('div', { class: 'pickers' }, pkLabel, pkPhoto),
      h('div', { class: 'ai-bar' + (aiBusy ? ' busy' : '') },
        h('span', null, aiMsg || 'Basta la foto dell’etichetta: l’AI legge i dati e cerca il capo online. La foto del capo serve solo se online non si trova.'),
        (pending.photo || pending.label) && !aiBusy ? h('button', { type: 'button', class: 'mini', onclick: runAI }, 'Rileggi') : null),
      webPanel(web, { ...handlers, canSearch: canLookup(lookupQuery()) && !aiBusy, catalogPreview,
        hint: (pending.label || pending.photo) && !aiBusy && aiMsg ? 'Niente da cercare online: in etichetta non ci sono codici né marca. Scrivi la marca qui sotto e torna qui, oppure fotografa il cartellino.' : null }),
      !web.picked && !pending.catalog && draft.catalog_photo_path ? h('p', { class: 'fhint' }, 'Questo capo ha già una foto di catalogo: una nuova ricerca la sostituisce solo se scegli un altro risultato.') : null,
      ctl.cover ? field('Foto di copertina', ctl.cover, 'Quella che vedi nell’armadio e negli outfit.') : null,
      section('Che cos’è',
        field(lab('Categoria', 'category'), ctl.category),
        field(lab('Nome', 'name'), ctl.name),
        field(lab('Marca', 'brand'), ctl.brand),
        field(lab('Colore dominante', 'color_primary'), ctl.color, !pending.photo && !draft.photo_path && !web.picked ? 'Senza foto del capo il colore va scelto a mano o confermato dalla ricerca online.' : null),
        field(lab('Colori secondari', 'colors_secondary'), ctl.colors2)),
      section('Etichetta',
        field(lab('Composizione', 'composition'), ctl.composition),
        field(lab('Tessuto', 'fabric'), ctl.fabric, 'Il prevalente: si compila dalla composizione, puoi cambiarlo.'),
        h('div', { class: 'row2' }, field(lab('Taglia', 'size_label'), ctl.size), field(lab('Sistema', 'size_system'), ctl.system)),
        (draft.size_alt || []).length ? h('p', { class: 'fhint' }, 'Altre taglie in etichetta: ', draft.size_alt.map((s) => `${s.label} ${SIZE_SYSTEMS[s.system]}`).join(', ')) : null,
        field(lab('Vestibilità', 'fit'), ctl.fit),
        h('div', { class: 'row2' }, field(lab('Codice articolo', 'article_code'), ctl.article), field(lab('Codice colore', 'color_code'), ctl.colorCode)),
        field(lab('Codice a barre', 'ean'), ctl.ean, draft.ean && !validEan(draft.ean) ? 'Cifra di controllo non valida: ricontrolla le cifre.' : 'Se correggi un codice, premi “Cerca online”.'),
        field(lab('Lavaggio', 'care'), ctl.care)),
      section('Quando lo usi',
        field(lab('Stagioni', 'seasons'), ctl.seasons),
        field(lab('Occasioni', 'occasions'), ctl.occasions),
        field(lab('Peso', 'warmth'), ctl.warmth)),
      section('Come ti veste',
        field('Su di te è', ctl.fitFeel, 'Serve a imparare le tue taglie reali per marca.')),
      section('Altro',
        h('div', { class: 'row2' }, field('Prezzo pagato', ctl.price), field(lab('Prezzo di listino', 'list_price'), ctl.listPrice)),
        field('Acquistato il', ctl.purchased),
        field('Note', ctl.notes)),
      h('div', { class: 'savebar' },
        h('button', { type: 'button', class: 'btn ghost', onclick: () => history.back() }, 'Annulla'),
        h('button', { type: 'submit', class: 'btn', disabled: aiBusy || web.imgBusy }, isNew ? 'Salva' : 'Salva modifiche')),
    ))
  }

  async function save() {
    collect()
    if (!draft.category) { toast('Scegli la categoria'); ctl.category.focus(); return }
    if (!draft.color_primary) { toast('Scegli il colore dominante'); return }
    const id = await saveItem(draft, pending, existing)
    if (batchId) await batch.remove(batchId)
    toast(isNew ? 'Salvato nel guardaroba' : 'Modifiche salvate')
    go(`#/capo/${id}`, { replace: true })
  }

  build()
  if (startCatalog && !pending.catalog) loadCatalog(startCatalog)
}
