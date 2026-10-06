import { h, put, add, toast, choices, swatches, field, section, photoPicker } from '../ui.js'
import { state, upsert, upload, removeFiles, uuid } from '../store.js'
import { CATEGORIES, SEASONS, OCCASIONS, OCCASION_HINT, FIT_FEEL, WARMTH, SIZE_SYSTEMS, FABRICS, compositionToText, textToComposition, fabricFromComposition } from '../taxonomy.js'
import { prepare, toBase64, imageURL } from '../images.js'
import { analyze } from '../ai.js'

const FIELDS = ['kind', 'category', 'name', 'brand', 'color_primary', 'colors_secondary', 'composition', 'fabric', 'fit', 'size_label', 'size_system',
  'size_alt', 'care', 'warmth', 'seasons', 'occasions', 'fit_feel', 'price', 'purchased_on', 'photo_path', 'thumb_path', 'label_photo_path', 'notes', 'archived']

let handoff = null // dati passati dalla modalità shopping
export function setDraft(d) { handoff = d }

export const title = 'Capo'

export function render(root, { go, params }) {
  const existing = params.id ? state.items.find((i) => i.id === params.id) : null
  if (params.id && !existing) { add(root, h('p', { class: 'empty' }, 'Capo non trovato')); return }
  const isNew = !existing
  let draft = existing ? structuredClone(existing) : { colors_secondary: [], composition: [], care: [], seasons: [], occasions: [], size_alt: [] }
  const pending = { photo: null, label: null }
  if (isNew && handoff) { Object.assign(draft, handoff.fields || {}); pending.photo = handoff.photo || null; pending.label = handoff.label || null; handoff = null }
  const aiFilled = new Set()
  const aiValues = new Map() // ultimo valore messo dall'AI per campo: se non l'hai cambiato, una nuova lettura può aggiornarlo
  let aiBusy = false, aiMsg = ''

  const form = h('form', { class: 'itemform', novalidate: true, onsubmit: (e) => { e.preventDefault(); save() } })
  add(root, form)
  let ctl = {}

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
    if (res) {
      for (const [k, v] of Object.entries(res.fields)) {
        const empty = v == null || (Array.isArray(v) && !v.length)
        const curEmpty = draft[k] == null || draft[k] === '' || (Array.isArray(draft[k]) && !draft[k].length)
        const untouchedAI = aiValues.has(k) && aiValues.get(k) === JSON.stringify(draft[k] ?? null)
        if (!empty && (curEmpty || untouchedAI)) { draft[k] = v; aiFilled.add(k); aiValues.set(k, JSON.stringify(v)) }
      }
      aiMsg = res.readable || !pending.label ? 'Dati letti: controlla i campi segnati e correggi se serve.' : 'Etichetta poco leggibile: controlla bene i campi.'
    }
    aiBusy = false
    build()
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
    draft.price = ctl.price.value === '' ? null : Number(String(ctl.price.value).replace(',', '.'))
    draft.purchased_on = ctl.purchased.value || null
    draft.notes = ctl.notes.value.trim() || null
  }

  const mark = (k) => (aiFilled.has(k) ? h('em', { class: 'ai-tag' }, 'letto') : null)
  const lab = (text, k) => h('span', null, text, mark(k))

  function build() {
    const catSelect = h('select', { required: true },
      h('option', { value: '' }, 'Scegli…'),
      h('optgroup', { label: 'Abbigliamento' }, Object.entries(CATEGORIES).filter(([, c]) => c.kind === 'garment').map(([k, c]) => h('option', { value: k, selected: draft.category === k }, c.label))),
      h('optgroup', { label: 'Calzature' }, Object.entries(CATEGORIES).filter(([, c]) => c.kind === 'footwear').map(([k, c]) => h('option', { value: k, selected: draft.category === k }, c.label))))
    const sysSelect = h('select', null, h('option', { value: '' }, '—'), Object.entries(SIZE_SYSTEMS).map(([k, v]) => h('option', { value: k, selected: draft.size_system === k }, v)))
    ctl = {
      category: catSelect,
      name: h('input', { type: 'text', value: draft.name || '', placeholder: 'Facoltativo, es. Oxford del matrimonio', autocomplete: 'off' }),
      brand: h('input', { type: 'text', value: draft.brand || '', autocomplete: 'off', autocapitalize: 'words', list: 'brands' }),
      color: swatches(draft.color_primary, { onchange: () => ctl.colors2.refresh() }),
      colors2: null,
      composition: h('input', { type: 'text', value: compositionToText(draft.composition), placeholder: '98% cotone, 2% elastan',
        onchange: (e) => { const f = fabricFromComposition(textToComposition(e.target.value)); if (f && !ctl.fabric.value) ctl.fabric.value = f } }),
      fabric: choices(Object.fromEntries(Object.entries(FABRICS).map(([k, v]) => [k, v.label])), draft.fabric),
      fit: h('input', { type: 'text', value: draft.fit || '', list: 'fits', placeholder: 'slim, regular…' }),
      size: h('input', { type: 'text', value: draft.size_label || '', placeholder: '50, M, 41, W32 L34', autocapitalize: 'characters' }),
      system: sysSelect,
      care: h('textarea', { rows: 3, placeholder: 'Una istruzione per riga' }, (draft.care || []).join('\n')),
      warmth: choices(WARMTH, draft.warmth ? String(draft.warmth) : null),
      seasons: choices(SEASONS, draft.seasons, { multi: true }),
      occasions: choices(OCCASIONS, draft.occasions, { multi: true, hints: OCCASION_HINT }),
      fitFeel: choices(FIT_FEEL, draft.fit_feel),
      price: h('input', { type: 'text', inputmode: 'decimal', value: draft.price ?? '', placeholder: '€' }),
      purchased: h('input', { type: 'date', value: draft.purchased_on || '' }),
      notes: h('textarea', { rows: 2 }, draft.notes || ''),
    }
    ctl.colors2 = swatches(draft.colors_secondary, { multi: true, exclude: () => ctl.color.value })

    const brands = [...new Set(state.items.map((i) => i.brand).filter(Boolean))].sort()
    const photoPreview = pending.photo ? URL.createObjectURL(pending.photo.thumb) : null
    const labelPreview = pending.label ? URL.createObjectURL(pending.label.ai) : null
    const pkPhoto = photoPicker('Foto del capo', { preview: photoPreview, onpick: async (f) => { pending.photo = await prepare(f); runAI() } })
    const pkLabel = photoPicker('Foto dell’etichetta', { preview: labelPreview, onpick: async (f) => { const p = await prepare(f); pending.label = { full: p.full, ai: p.ai }; runAI() } })
    if (!pending.photo && existing?.thumb_path) imageURL(existing.thumb_path).then((u) => pkPhoto.setPreview(u))
    if (!pending.label && existing?.label_photo_path) imageURL(existing.label_photo_path).then((u) => pkLabel.setPreview(u))

    put(form, 
      h('datalist', { id: 'brands' }, brands.map((b) => h('option', { value: b }))),
      h('datalist', { id: 'fits' }, ['slim', 'regular', 'comfort', 'tailored', 'oversize'].map((b) => h('option', { value: b }))),
      h('div', { class: 'pickers' }, pkPhoto, pkLabel),
      h('div', { class: 'ai-bar' + (aiBusy ? ' busy' : '') },
        h('span', null, aiMsg || 'Con la foto dell’etichetta l’AI compila composizione, taglia e lavaggio.'),
        (pending.photo || pending.label) && !aiBusy ? h('button', { type: 'button', class: 'mini', onclick: runAI }, 'Rileggi') : null),
      section('Che cos’è',
        field(lab('Categoria', 'category'), ctl.category),
        field('Nome', ctl.name),
        field(lab('Marca', 'brand'), ctl.brand),
        field(lab('Colore dominante', 'color_primary'), ctl.color),
        field(lab('Colori secondari', 'colors_secondary'), ctl.colors2)),
      section('Etichetta',
        field(lab('Composizione', 'composition'), ctl.composition),
        field(lab('Tessuto', 'fabric'), ctl.fabric, 'Il prevalente: si compila dalla composizione, puoi cambiarlo.'),
        h('div', { class: 'row2' }, field(lab('Taglia', 'size_label'), ctl.size), field(lab('Sistema', 'size_system'), ctl.system)),
        (draft.size_alt || []).length ? h('p', { class: 'fhint' }, 'Altre taglie in etichetta: ', draft.size_alt.map((s) => `${s.label} ${SIZE_SYSTEMS[s.system]}`).join(', ')) : null,
        field(lab('Vestibilità', 'fit'), ctl.fit),
        field(lab('Lavaggio', 'care'), ctl.care)),
      section('Quando lo usi',
        field(lab('Stagioni', 'seasons'), ctl.seasons),
        field(lab('Occasioni', 'occasions'), ctl.occasions),
        field(lab('Peso', 'warmth'), ctl.warmth)),
      section('Come ti veste',
        field('Su di te è', ctl.fitFeel, 'Serve a imparare le tue taglie reali per marca.')),
      section('Altro',
        h('div', { class: 'row2' }, field('Prezzo', ctl.price), field('Acquistato il', ctl.purchased)),
        field('Note', ctl.notes)),
      h('div', { class: 'savebar' },
        h('button', { type: 'button', class: 'btn ghost', onclick: () => history.back() }, 'Annulla'),
        h('button', { type: 'submit', class: 'btn', disabled: aiBusy }, isNew ? 'Salva' : 'Salva modifiche')),
    )
  }

  async function save() {
    collect()
    if (!draft.category) { toast('Scegli la categoria'); ctl.category.focus(); return }
    if (!draft.color_primary) { toast('Scegli il colore dominante'); return }
    const id = draft.id || uuid()
    const uid = state.user.id, ts = Date.now()
    const old = []
    if (pending.photo) {
      old.push(existing?.photo_path, existing?.thumb_path)
      draft.photo_path = `${uid}/${id}/photo-${ts}.jpg`
      draft.thumb_path = `${uid}/${id}/thumb-${ts}.jpg`
      await upload(draft.photo_path, pending.photo.full)
      await upload(draft.thumb_path, pending.photo.thumb)
    }
    if (pending.label) {
      old.push(existing?.label_photo_path)
      draft.label_photo_path = `${uid}/${id}/label-${ts}.jpg`
      await upload(draft.label_photo_path, pending.label.full)
    }
    const row = { id }
    for (const k of FIELDS) row[k] = draft[k] ?? (['colors_secondary', 'composition', 'care', 'seasons', 'occasions', 'size_alt'].includes(k) ? [] : null)
    row.archived = !!draft.archived
    await upsert('items', row)
    await removeFiles(old)
    toast(isNew ? 'Salvato nel guardaroba' : 'Modifiche salvate')
    go(`#/capo/${id}`, { replace: true })
  }

  build()
}

