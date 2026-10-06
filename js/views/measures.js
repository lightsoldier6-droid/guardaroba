import { h, put, add, toast, section, fmtDate } from '../ui.js'
import { state, upsert, uuid, latestMeasures } from '../store.js'
import { MEASURES, SHOE_MEASURES, SIZE_GROUPS, SIZE_SYSTEMS } from '../taxonomy.js'
import { referenceTable, brandExceptions, GROUPS, SYSTEMS } from '../sizes.js'
import { toDay } from '../outfit.js'

export const title = 'Le mie misure'

const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) && n > 0 ? n : null }

export function render(root) {
  const last = latestMeasures()
  const inputs = {}
  const row = (m) => {
    const inp = h('input', { type: 'text', inputmode: 'decimal', value: last?.[m.key] ?? '', placeholder: '—', 'aria-label': m.label })
    inputs[m.key] = inp
    return h('div', { class: 'mrow' },
      h('div', { class: 'mrow-l' }, h('span', null, m.label), h('p', { class: 'how' }, m.how)),
      h('div', { class: 'mrow-i' }, inp, h('span', { class: 'unit' }, m.unit)))
  }
  const shoeRow = h('div', { class: 'shoes4' }, SHOE_MEASURES.map((m) => {
    const inp = h('input', { type: 'text', inputmode: 'decimal', value: last?.[m.key] ?? '', placeholder: '—' })
    inputs[m.key] = inp
    return h('label', null, h('span', null, m.label.replace('Scarpe ', '')), inp)
  }))

  const save = () => {
    const today = toDay(new Date())
    const same = state.measures.find((x) => x.measured_on === today)
    const rec = { id: same?.id || uuid(), measured_on: today }
    let any = false
    for (const [k, inp] of Object.entries(inputs)) { rec[k] = num(inp.value); if (rec[k] != null) any = true }
    if (!any) { toast('Inserisci almeno una misura'); return }
    upsert('measurements', rec)
    toast('Misure salvate')
    rerenderTables()
  }

  const tables = h('div')
  const rerenderTables = () => put(tables, refTable(), exceptions(), history())

  add(root, 
    h('p', { class: 'muted intro' }, last ? `Ultimo aggiornamento: ${fmtDate(last.measured_on)}. Correggi ciò che è cambiato: ogni salvataggio resta nello storico.` : 'Metro da sarta, abiti leggeri, respiro normale. Bastano le misure che conosci.'),
    section('Corpo', MEASURES.map(row)),
    section('Numero di scarpa', h('p', { class: 'fhint' }, 'Se lo sai, inserisci il numero che usi più spesso in ciascun sistema.'), shoeRow),
    h('div', { class: 'savebar' }, h('button', { class: 'btn', type: 'button', onclick: save }, 'Salva le misure')),
    tables,
  )
  rerenderTables()
}

function refTable() {
  const ref = referenceTable(state.items.filter((i) => !i.archived), latestMeasures())
  const has = GROUPS.some((g) => SYSTEMS.some((s) => ref[g][s]))
  return section('Le tue taglie di riferimento',
    has ? h('div', { class: 'tablewrap' }, h('table', { class: 'sizes' },
      h('thead', null, h('tr', null, h('th', null, ''), SYSTEMS.map((s) => h('th', null, SIZE_SYSTEMS[s])))),
      h('tbody', null, GROUPS.map((g) => h('tr', null, h('th', null, SIZE_GROUPS[g]),
        SYSTEMS.map((s) => { const c = ref[g][s]; return h('td', { class: c?.source === 'wardrobe' ? 'obs' : '' }, c ? c.value : '–', c?.source === 'wardrobe' ? h('sup', null, c.n) : null) }))))))
      : h('p', { class: 'muted' }, 'Inserisci torace, vita, collo o piede, oppure indica “come ti veste” su qualche capo.'),
    has ? h('p', { class: 'fhint' }, h('b', null, 'Grassetto'), ': dai capi che ti stanno bene (il numero indica quanti). Normale: stima dalle misure con tabelle standard, da verificare in prova.') : null)
}

function exceptions() {
  const ex = brandExceptions(state.items.filter((i) => !i.archived), latestMeasures())
  if (!ex.length) return section('Eccezioni per marca', h('p', { class: 'muted' }, 'Nessuna marca si discosta dalle tue taglie, per ora.'))
  return section('Eccezioni per marca', h('ul', { class: 'exc' }, ex.map((e) =>
    h('li', null, h('b', null, e.brand), ` ${SIZE_GROUPS[e.group].toLowerCase()}: ${e.size} ${SIZE_SYSTEMS[e.system]}`, h('span', { class: 'muted' }, ` invece di ${e.ref}` + (e.n > 1 ? ` (${e.n} capi)` : ''))))))
}

function history() {
  const rows = state.measures
  if (rows.length < 1) return null
  const keys = MEASURES.filter((m) => rows.some((r) => r[m.key] != null))
  return section('Storico',
    h('div', { class: 'tablewrap' }, h('table', { class: 'hist' },
      h('thead', null, h('tr', null, h('th', null, 'Data'), keys.map((m) => h('th', null, m.label)))),
      h('tbody', null, rows.map((r) => h('tr', null, h('th', null, fmtDate(r.measured_on)), keys.map((m) => h('td', null, r[m.key] ?? '–'))))))))
}
