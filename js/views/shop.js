import { h, put, add, keepAnchor, toast, choices, swatches, field, section, photoPicker, thumb, verdictSymbol } from '../ui.js'
import { state, latestMeasures } from '../store.js'
import { CATEGORIES, COLORS, SEASONS, OCCASIONS, OCCASION_HINT, SIZE_SYSTEMS, FABRICS } from '../taxonomy.js'
import { prepare, toBase64, hydrate } from '../images.js'
import { analyze, readSizeGuide, lookup, readLink, canLookup } from '../ai.js'
import { webFields, mergeInto } from '../webmatch.js'
import { webPanel, newWebState } from './webPanel.js'
import { evaluate } from '../shopping.js'
import { itemName } from '../outfit.js'
import { setDraft } from './itemForm.js'

const blank = () => ({ category: null, color_primary: null, colors_secondary: [], seasons: [], occasions: [], price: null, brand: '', size_system: null, fabric: null, aiFields: null, codes: null })
let cand = blank()
let photos = { photo: null, label: null, guide: null }
let guide = null
let result = null
let msg = '', guideMsg = '', busy = false
let web = newWebState(), webApplied = null

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
    let r = null
    try {
      r = await analyze({ photo: photos.photo ? await toBase64(photos.photo.ai) : null, label: photos.label ? await toBase64(photos.label.ai) : null })
    } catch (e) { msg = e.message }
    collect() // conserva le scelte fatte durante l'attesa
    if (r) {
      const f = r.fields
      const prev = cand.aiFields || {}
      cand.aiFields = f
      const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length)
      const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
      for (const k of ['category', 'color_primary', 'size_system', 'fabric', 'colors_secondary', 'seasons', 'occasions', 'brand']) {
        if (!isEmpty(f[k]) && (isEmpty(cand[k]) || same(cand[k], prev[k]))) cand[k] = f[k]
      }
      cand.codes = r.codes
      msg = 'Controlla categoria, colori, stagioni e occasioni, poi valuta.'
    }
    busy = false
    build()
    if (r && navigator.onLine && canLookup(query()) && !web.picked && web.status !== 'busy') runLookup()
  }

  // ---- ricerca online dal cartellino: prezzo pieno, foto di catalogo, colore esatto
  const query = () => {
    const q = { brand: cand.brand || '', category: cand.category || '', ...Object.fromEntries(Object.entries(cand.codes || {}).map(([k, v]) => [k, v || ''])) }
    if (!q.color_name && cand.color_primary) q.color_name = COLORS[cand.color_primary]?.label.toLowerCase() || ''
    return q
  }
  async function runLookup() {
    collect(); unapply()
    web = { ...newWebState(), status: 'busy' }; build()
    try {
      const r = await lookup(query())
      collect()
      web = { ...newWebState(), status: 'done', result: r }
      if (r.level === 'exact') return applyWeb(0, r.candidates[0].variant, 'exact')
    } catch (e) { collect(); web = { ...newWebState(), status: 'error', msg: e.message } }
    build()
  }
  function unapply() {
    if (!webApplied) return
    for (const k of webApplied.keys) if (JSON.stringify(cand[k] ?? null) === webApplied.vals[k]) cand[k] = null
    webApplied = null
  }
  function applyWeb(ci, vi, level) {
    collect(); unapply()
    const c = web.result?.candidates?.[ci]
    if (!c) return
    const w = webFields(c, vi, { brand: cand.brand, matchLevel: level })
    const target = { category: cand.category, color_primary: cand.color_primary, fabric: cand.fabric }
    const keys = mergeInto(target, { category: w.fields.category, color_primary: w.fields.color_primary, fabric: w.fields.fabric })
    Object.assign(cand, target)
    webApplied = { keys, vals: Object.fromEntries(keys.map((k) => [k, JSON.stringify(cand[k] ?? null)])), w }
    web.picked = { ci, vi, level }; web.choosing = null
    if (!cand.price && w.fields.list_price) cand.price = w.fields.list_price
    build()
  }
  async function runLink(url) {
    collect(); unapply()
    web = { ...newWebState(), status: 'busy' }; build()
    try {
      const r = await readLink(url)
      collect()
      web = { ...newWebState(), status: 'done', result: r }
      const c = r.candidates[0]
      if (c?.brand && !cand.brand) cand.brand = c.brand.replace(/[®™©]/g, '').trim()
      if (r.level === 'exact') return applyWeb(0, c.variant, 'chosen')
      web.choosing = 0
    } catch (e) { collect(); web = { ...newWebState(), status: 'error', msg: e.message } }
    build()
  }
  const webHandlers = {
    link: (url) => runLink(url),
    linkOpen: true,
    search: () => runLookup(),
    apply: (ci, vi, level) => applyWeb(ci, vi, level),
    choose: (ci) => { collect(); unapply(); web.picked = null; web.choosing = ci; build() },
    reject: () => { collect(); unapply(); web.picked = null; web.choosing = null; web.rejected = true; build() },
    none: () => { collect(); unapply(); web.picked = null; web.choosing = null; web.rejected = true; web.noneByUser = true; web.result = { level: 'none', candidates: [] }; build() },
  }

  async function readGuide() {
    if (!photos.guide) return
    collect(); guideMsg = 'Lettura della guida taglie…'; build()
    try {
      guide = await readSizeGuide(await toBase64(photos.guide.ai))
      collect()
      guideMsg = guide?.rows?.length ? `Guida letta: ${guide.rows.length} taglie${guide.system ? ` (${SIZE_SYSTEMS[guide.system]})` : ''}.` : 'Non sono riuscito a leggere la tabella: riprova con una foto più dritta.'
      if (guide?.system && !cand.size_system) cand.size_system = guide.system
    } catch (e) { collect(); guideMsg = e.message } finally { build() }
  }

  function run() {
    collect()
    if (!cand.category) { toast('Scegli la categoria del capo'); return }
    if (!cand.color_primary) { toast('Scegli il colore dominante'); return }
    result = evaluate({ candidate: cand, items: state.items, wearLog: state.wearLog, measures: latestMeasures(), guide })
    build()
    requestAnimationFrame(() => wrap.querySelector('.verdict')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  function reset() { cand = blank(); photos = { photo: null, label: null, guide: null }; guide = null; result = null; msg = guideMsg = ''; web = newWebState(); webApplied = null; build(); window.scrollTo(0, 0) }

  function bought() {
    const f = cand.aiFields || {}
    const wf = webApplied?.w?.fields || {}
    const fromWeb = webApplied ? ['name', 'list_price', 'source_url', 'match_level', ...(f.composition?.length ? [] : ['composition', 'fabric'])].filter((k) => wf[k] != null && !(Array.isArray(wf[k]) && !wf[k].length)) : []
    setDraft({
      webFilled: [...fromWeb, ...(webApplied?.keys || [])],
      web: web.status === 'done' ? { status: 'done', result: web.result, picked: web.picked, rejected: web.rejected, noneByUser: web.noneByUser } : null,
      catalogUrl: webApplied?.w?.imageUrl || null,
      labelCodes: { color_name: cand.codes?.color_name || null, model_name: cand.codes?.model_name || null },
      fields: {
        ...f, ...Object.fromEntries(fromWeb.map((k) => [k, wf[k]])),
        article_code: cand.codes?.article_code || null, color_code: cand.codes?.color_code || null, ean: cand.codes?.ean || null,
        category: cand.category, kind: CATEGORIES[cand.category]?.kind, brand: cand.brand || f.brand || null,
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
      h('optgroup', { label: 'Calzature' }, Object.entries(CATEGORIES).filter(([, c]) => c.kind === 'footwear').map(([k, c]) => h('option', { value: k, selected: cand.category === k }, c.label))),
      h('optgroup', { label: 'Accessori' }, Object.entries(CATEGORIES).filter(([, c]) => c.kind === 'accessory').map(([k, c]) => h('option', { value: k, selected: cand.category === k }, c.label))))
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

    keepAnchor(wrap, () => put(wrap, 
      h('datalist', { id: 'shopbrands' }, [...new Set(state.items.map((i) => i.brand).filter(Boolean))].map((b) => h('option', { value: b }))),
      h('div', { class: 'pickers three' },
        photoPicker('Capo', { camera: true, preview: url(photos.photo?.thumb), onpick: async (f) => { photos.photo = await prepare(f); readPhotos() } }),
        photoPicker('Etichetta', { camera: true, preview: url(photos.label?.ai), onpick: async (f) => { photos.label = await prepare(f); readPhotos() } }),
        photoPicker('Guida taglie', { camera: true, preview: url(photos.guide?.ai), onpick: async (f) => { photos.guide = await prepare(f); readGuide() } })),
      msg || guideMsg ? h('div', { class: 'ai-bar' + (busy ? ' busy' : '') }, h('span', null, [msg, guideMsg].filter(Boolean).join(' '))) : null,
      webPanel(web, { ...webHandlers, canSearch: canLookup(query()) && !busy }),
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
      result ? resultView(result, bought, webApplied?.w?.fields?.list_price) : null,
    ))
    hydrate(wrap)
  }
  build()
}

const VERDICT = { buy: 'Compralo', consider: 'Valuta', skip: 'Lascia perdere' }
const CONF = { alta: 'affidabilità alta', media: 'affidabilità media', bassa: 'affidabilità bassa' }

function resultView(r, bought, listPrice) {
  const s = r.size
  const paid = Number(r.price ?? cand.price)
  const off = listPrice && paid && paid < listPrice ? Math.round((1 - paid / listPrice) * 100) : 0
  return h('div', { class: 'result' },
    h('div', { class: `verdict label v-${r.verdict}` },
      h('span', { class: 'vsym', html: verdictSymbol[r.verdict], 'aria-hidden': 'true' }),
      h('div', null,
        h('div', { class: 'vscore', 'aria-label': `${VERDICT[r.verdict]}, punteggio ${r.score} su 100` }, h('b', null, r.score), h('span', null, '/100')),
        h('p', { class: 'vsent' }, r.sentence))),
    listPrice ? h('p', { class: 'note' }, off >= 5 ? `Prezzo pieno online ${listPrice.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}: qui è scontato del ${off}%.` : `Prezzo pieno online ${listPrice.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}: nessuno sconto rispetto al sito.`) : null,
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
        : h('p', { class: 'muted' }, s?.reason || (cand.category === 'belt' ? 'Cinture: la taglia è la lunghezza in cm. Prendi quella della cintura che usi di più, misurata dalla fibbia al foro centrale.' : 'Scegli la categoria per avere una taglia.'))),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: bought }, 'L’ho comprato: aggiungi all’armadio')),
  )
}
