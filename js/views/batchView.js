import { h, add, toast, section, icon, remoteImg } from '../ui.js'
import { CATEGORIES } from '../taxonomy.js'
import { prepare } from '../images.js'
import { LEVEL_TEXT, modelName } from '../webmatch.js'
import * as batch from '../batch.js'
import { setDraft } from './itemForm.js'

export const title = 'Etichette a raffica'

let current = null, timer = null
batch.onChange(() => { clearTimeout(timer); timer = setTimeout(() => current?.(), 60) })

const GROUPS = [
  ['exact', 'Corrispondono', 'Modello e colore riconosciuti dai codici. Controlla e conferma.'],
  ['model', 'Scegli il colore', 'Modello trovato: apri e tocca il colore che hai.'],
  ['possible', 'Da identificare', 'Risultati incerti: apri e scegli quello giusto, o nessuno.'],
  ['none', 'Non trovati', 'Apri, aggiungi una foto del capo e controlla i campi.'],
  ['working', 'In lavorazione', null],
  ['queued', 'In coda', 'Partono appena c’è rete, con l’app aperta.'],
  ['error', 'Errori', null],
]

export function render(root, { go, rerender }) {
  current = () => { if (location.hash === '#/raffica') rerender() }
  if (!batch.bstate.loaded) { batch.load(); add(root, h('p', { class: 'muted' }, 'Carico…')); return }
  const list = batch.bstate.list
  let busyAdd = false

  async function addFiles(files) {
    if (busyAdd || !files.length) return
    busyAdd = true
    toast(files.length === 1 ? 'Etichetta aggiunta alla coda' : `Preparo ${files.length} etichette…`)
    const prepared = []
    for (const f of files) {
      try { const p = await prepare(f); prepared.push({ full: p.full, ai: p.ai }) } catch { /* foto illeggibile: salta */ }
    }
    busyAdd = false
    await batch.addLabels(prepared)
  }
  const fileInput = (opts) => {
    const input = h('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', ...opts })
    input.addEventListener('change', () => { const fs = [...(input.files || [])]; input.value = ''; addFiles(fs) })
    return input
  }

  function open(e) {
    const d = batch.draftOf(e)
    setDraft({
      fields: d.fields, label: { full: e.label.full, ai: e.label.ai }, aiFilled: d.aiFilled, webFilled: d.webFilled,
      labelCodes: { color_name: e.codes?.color_name || null, model_name: e.codes?.model_name || null },
      web: e.web ? { status: 'done', result: e.web, picked: d.picked } : null,
      catalogUrl: d.catalogUrl, batchId: e.id,
    })
    go('#/capo/nuovo')
  }

  function row(e) {
    const lvl = batch.levelOf(e)
    const f = e.fields || {}
    const c = e.web?.candidates?.[0]
    const v = c && c.variant >= 0 ? c.variants?.[c.variant] : null
    const img = (lvl === 'exact' || lvl === 'model') && (v?.image || c?.image)
      ? remoteImg(v?.image || c.image, 'ph')
      : h('span', { class: 'ph' }, h('img', { src: URL.createObjectURL(e.label.ai), alt: '' }))
    const name = [f.brand, (c && (lvl === 'exact' || lvl === 'model') ? modelName(c, f.brand || c.brand) : null) || CATEGORIES[f.category]?.label].filter(Boolean).join(' · ') || 'Etichetta'
    const codes = [e.codes?.article_code, e.codes?.color_code].filter(Boolean).join(' / ')
    const sub = lvl === 'working' ? (e.status === 'reading' ? 'Lettura dell’etichetta…' : 'Ricerca online…')
      : lvl === 'queued' ? 'In attesa'
      : lvl === 'error' ? e.error
      : [codes && `Codice ${codes}`, e.web?.note].filter(Boolean).join(' · ') || LEVEL_TEXT[lvl]
    return h('div', { class: 'brow' },
      img,
      h('div', { class: 'brow-b' }, h('b', null, name), h('span', { class: 'muted' }, sub)),
      h('div', { class: 'brow-a' },
        ['exact', 'model', 'possible', 'none'].includes(lvl) ? h('button', { type: 'button', class: 'mini', onclick: () => open(e) }, 'Apri') : null,
        lvl === 'error' ? h('button', { type: 'button', class: 'mini', onclick: () => batch.retry(e.id) }, 'Riprova') : null,
        lvl !== 'working' ? h('button', { type: 'button', class: 'link', 'aria-label': 'Scarta', onclick: () => batch.remove(e.id) }, 'Scarta') : null))
  }

  async function confirmAll() {
    const n = list.filter((e) => batch.levelOf(e) === 'exact').length
    toast(`Salvo ${n} capi…`)
    const { saved, skipped } = await batch.confirmExact()
    toast(`${saved} ${saved === 1 ? 'capo salvato' : 'capi salvati'} nell’armadio` + (skipped ? `; ${skipped} da completare a mano` : ''))
  }

  const counts = Object.fromEntries(GROUPS.map(([k]) => [k, list.filter((e) => batch.levelOf(e) === k)]))
  add(root,
    h('p', { class: 'intro' }, 'Fotografa le etichette una dopo l’altra, senza fermarti. Lettura e ricerca online vanno avanti da sole; poi rivedi qui, a partire da quelle già riconosciute.'),
    h('div', { class: 'pickers short' },
      h('label', { class: 'picker' }, fileInput({ capture: 'environment' }), h('span', { class: 'pk-label' }, h('span', { html: icon.camera }), 'Scatta un’etichetta')),
      h('label', { class: 'picker' }, fileInput({ multiple: true }), h('span', { class: 'pk-label' }, h('span', { html: icon.plus }), 'Scegli più foto dalla libreria'))),
    !navigator.onLine && list.some((e) => e.status === 'queued') ? h('p', { class: 'note' }, 'Sei offline: le etichette restano in coda e partono al ritorno della rete.') : null,
    !list.length ? h('div', { class: 'empty' }, h('h3', null, 'Nessuna etichetta in coda'), h('p', null, 'Inquadra bene etichetta e cartellino: codice articolo, codice colore e codice a barre sono quelli che fanno trovare il capo.')) : null,
    GROUPS.map(([k, label, hint]) => counts[k].length ? section(`${label} (${counts[k].length})`,
      hint ? h('p', { class: 'fhint' }, hint) : null,
      k === 'exact' && counts[k].length > 1 ? h('button', { type: 'button', class: 'btn', onclick: confirmAll }, `Conferma tutti (${counts[k].length})`) : null,
      h('div', { class: 'blist' }, counts[k].map(row))) : null),
  )
}
