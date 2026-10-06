import { h, put, add, toast, choices, swatches, field, section, photoPicker, thumb, verdictSymbol } from '../ui.js'
import { state, latestMeasures } from '../store.js'
import { CATEGORIES, SEASONS, OCCASIONS, OCCASION_HINT, SIZE_SYSTEMS, FABRICS } from '../taxonomy.js'
import { prepare, toBase64, hydrate } from '../images.js'
import { analyze, readSizeGuide } from '../ai.js'
import { evaluate } from '../shopping.js'
import { itemName } from '../outfit.js'
import { setDraft } from './itemForm.js'

const blank = () => ({ category: null, color_primary: null, colors_secondary: [], seasons: [], occasions: [], price: null, brand: '', size_system: null, fabric: null, aiFields: null })
let cand = blank()
let photos = { photo: null, label: null, guide: null }
let guide = null
let result = null
let msg = '', guideMsg = '', busy = false

export const title = 'In negozio'

export function render(root, { go }) {
  const wrap = h('div')
  add(root, wrap)
  let ctl = {}

  const collect = () => {
    if (!ctl.category) return
    cand.category = ctl.category.value || null
    cand.color_primary = ctl.color.value
    cand.colors_secondary = ctl.colors2.value.filter((c) => c !== cand.color_primary)
    cand.seasons = ctl.seasons.value
    cand.occasions = ctl.occasions.value
    cand.size_system = ctl.system.value || null
    cand.fabric = ctl.fabric.value
    cand.brand = ctl.brand.value.trim()
    const p = parseFloat(String(ctl.price.value).replace(',', '.'))
    cand.price = isFinite(p) && p > 0 ? p : null
  }

  async function readPhotos() {
    if (busy || (!photos.photo && !photos.label)) return
    collect(); busy = true; msg = 'Lettura in corso…'; build()
    try {
      const r = await analyze({ photo: photos.photo ? await toBase64(photos.photo.ai) : null, label: photos.label ? await toBase64(photos.label.ai) : null })
      const f = r.fields
      cand.aiFields = f
      for (const k of ['category', 'color_primary', 'size_system', 'fabric']) if (f[k]) cand[k] = f[k]
      for (const k of ['colors_secondary', 'seasons', 'occasions']) if (f[k]?.length) cand[k] = f[k]
      if (f.brand && !cand.brand) cand.brand = f.brand
      msg = 'Controlla categoria, colori, stagioni e occasioni, poi valuta.'
    } catch (e) { msg = e.message } finally { busy = false; build() }
  }

  async function readGuide() {
    if (!photos.guide) return
    collect(); guideMsg = 'Lettura della guida taglie…'; build()
    try {
      guide = await readSizeGuide(await toBase64(photos.guide.ai))
      guideMsg = guide?.rows?.length ? `Guida letta: ${guide.rows.length} taglie${guide.system ? ` (${SIZE_SYSTEMS[guide.system]})` : ''}.` : 'Non sono riuscito a leggere la tabella: riprova con una foto più dritta.'
      if (guide?.system && !cand.size_system) cand.size_system = guide.system
    } catch (e) { guideMsg = e.message } finally { build() }
  }

  function run() {
    collect()
    if (!cand.category) { toast('Scegli la categoria del capo'); return }
    if (!cand.color_primary) { toast('Scegli il colore dominante'); return }
    result = evaluate({ candidate: cand, items: state.items, wearLog: state.wearLog, measures: latestMeasures(), guide })
    build()
    requestAnimationFrame(() => wrap.querySelector('.verdict')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  function reset() { cand = blank(); photos = { photo: null, label: null, guide: null }; guide = null; result = null; msg = guideMsg = ''; build(); window.scrollTo(0, 0) }

  function bought() {
    const f = cand.aiFields || {}
    setDraft({
      fields: {
        ...f, category: cand.category, kind: CATEGORIES[cand.category]?.kind, brand: cand.brand || f.brand || null,
        color_primary: cand.color_primary, colors_secondary: cand.colors_secondary, seasons: cand.seasons, occasions: cand.occasions,
        price: cand.price, purchased_on: new Date().toISOString().slice(0, 10),
        size_system: cand.size_system || f.size_system || null,
        fabric: cand.fabric || f.fabric || null,
        size_label: result?.size?.size && (!f.size_label) ? result.size.size : f.size_label || null,
      },
      photo: photos.photo, label: photos.label ? { full: photos.label.full, ai: photos.label.ai } : null,
    })
    reset()
    go('#/capo/nuovo')
  }

  function build() {
    const sel = h('select', null, h('option', { value: '' }, 'Scegli…'),
      h('optgroup', { label: 'Abbigliamento' }, Object.entries(CATEGORIES).filter(([, c]) => c.kind === 'garment').map(([k, c]) => h('option', { value: k, selected: cand.category === k }, c.label))),
      h('optgroup', { label: 'Calzature' }, Object.entries(CATEGORIES).filter(([, c]) => c.kind === 'footwear').map(([k, c]) => h('option', { value: k, selected: cand.category === k }, c.label))))
    ctl = {
      category: sel,
      color: swatches(cand.color_primary, { onchange: () => ctl.colors2.refresh() }),
      colors2: null,
      fabric: choices(Object.fromEntries(Object.entries(FABRICS).map(([k, v]) => [k, v.label])), cand.fabric),
      seasons: choices(SEASONS, cand.seasons, { multi: true }),
      occasions: choices(OCCASIONS, cand.occasions, { multi: true, hints: OCCASION_HINT }),
      system: h('select', null, h('option', { value: '' }, 'Automatico'), Object.entries(SIZE_SYSTEMS).map(([k, v]) => h('option', { value: k, selected: cand.size_system === k }, v))),
      brand: h('input', { type: 'text', value: cand.brand, autocapitalize: 'words', list: 'shopbrands', autocomplete: 'off' }),
      price: h('input', { type: 'text', inputmode: 'decimal', value: cand.price ?? '', placeholder: '€' }),
    }
    ctl.colors2 = swatches(cand.colors_secondary, { multi: true, exclude: () => ctl.color.value })
    const url = (b) => (b ? URL.createObjectURL(b) : null)

    put(wrap, 
      h('datalist', { id: 'shopbrands' }, [...new Set(state.items.map((i) => i.brand).filter(Boolean))].map((b) => h('option', { value: b }))),
      h('div', { class: 'pickers three' },
        photoPicker('Capo', { camera: true, preview: url(photos.photo?.thumb), onpick: async (f) => { photos.photo = await prepare(f); readPhotos() } }),
        photoPicker('Etichetta', { camera: true, preview: url(photos.label?.ai), onpick: async (f) => { photos.label = await prepare(f); readPhotos() } }),
        photoPicker('Guida taglie', { camera: true, preview: url(photos.guide?.ai), onpick: async (f) => { photos.guide = await prepare(f); readGuide() } })),
      msg || guideMsg ? h('div', { class: 'ai-bar' + (busy ? ' busy' : '') }, h('span', null, [msg, guideMsg].filter(Boolean).join(' '))) : null,
      h('div', { class: 'row2' }, field('Prezzo', ctl.price), field('Marca', ctl.brand)),
      section(null,
        field('Categoria', ctl.category),
        field('Colore dominante', ctl.color),
        field('Colori secondari', ctl.colors2),
        field('Tessuto', ctl.fabric),
        field('Stagioni', ctl.seasons),
        field('Occasioni', ctl.occasions),
        field('Sistema taglie del negozio', ctl.system)),
      h('div', { class: 'savebar' },
        result ? h('button', { type: 'button', class: 'btn ghost', onclick: reset }, 'Nuovo capo') : null,
        h('button', { type: 'button', class: 'btn', onclick: run, disabled: busy }, result ? 'Rivaluta' : 'Valuta')),
      result ? resultView(result, bought) : null,
    )
    hydrate(wrap)
  }
  build()
}

const VERDICT = { buy: 'Compralo', consider: 'Valuta', skip: 'Lascia perdere' }
const CONF = { alta: 'affidabilità alta', media: 'affidabilità media', bassa: 'affidabilità bassa' }

function resultView(r, bought) {
  const s = r.size
  return h('div', { class: 'result' },
    h('div', { class: `verdict label v-${r.verdict}` },
      h('span', { class: 'vsym', html: verdictSymbol[r.verdict], 'aria-hidden': 'true' }),
      h('div', null,
        h('div', { class: 'vscore', 'aria-label': `${VERDICT[r.verdict]}, punteggio ${r.score} su 100` }, h('b', null, r.score), h('span', null, '/100')),
        h('p', { class: 'vsent' }, r.sentence))),
    h('ul', { class: 'reasons' }, r.reasons.map((x) => h('li', { class: x.good === true ? 'good' : x.good === false ? 'bad' : '' },
      h('span', null, x.text),
      x.items?.length ? h('div', { class: 'mini-strip' }, x.items.slice(0, 4).map((it) => h('a', { href: `#/capo/${it.id}` }, thumb(it), h('small', null, itemName(it))))) : null))),
    r.unlocked.examples.length ? section('Esempi di outfit', r.unlocked.examples.map((ex) =>
      h('div', { class: 'mini-strip' }, h('span', { class: 'plus' }, 'Con'), ex.map((it) => h('a', { href: `#/capo/${it.id}` }, thumb(it), h('small', null, itemName(it))))))) : null,
    section('Taglia da provare',
      s?.size ? h('div', { class: 'sizepick' },
        h('b', null, `${s.size} ${SIZE_SYSTEMS[s.system] || ''}`),
        h('span', { class: `conf c-${s.confidence}` }, CONF[s.confidence]),
        h('p', null, s.reason.charAt(0).toUpperCase() + s.reason.slice(1) + '.'),
        s.alt ? h('p', { class: 'muted' }, `Se non va: ${s.alt}.`) : null)
        : h('p', { class: 'muted' }, s?.reason || 'Scegli la categoria per avere una taglia.')),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: bought }, 'L’ho comprato: aggiungi all’armadio')),
  )
}
