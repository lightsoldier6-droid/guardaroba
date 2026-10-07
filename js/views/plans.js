// Eventi e viaggi: elenco, scheda (evento o viaggio) e modulo.
//  evento  → 3 proposte per il dress code e il meteo del giorno; ne scegli una
//  viaggio → un outfit per giorno (impegni diversi) con meno capi possibile in valigia
import { h, add, put, toast, thumb, icon, field, section, choices } from '../ui.js'
import { state, upsert, patch, remove, uuid } from '../store.js'
import { DRESS_CODES, SLOTS } from '../taxonomy.js'
import { itemName, toDay, slotOf } from '../outfit.js'
import { eventOutfits, planTrip, alternativeFor, packingList, outfitsMatch, eveningWeather, PARTS } from '../plans.js'
import { getRangeWeather, getPlace, searchCity, datesBetween } from '../weather.js'
import { hydrate } from '../images.js'

export const title = 'Eventi e viaggi'
export const live = true

const DRESS = Object.fromEntries(Object.entries(DRESS_CODES).map(([k, v]) => [k, v.label]))
const DRESS_HINT = Object.fromEntries(Object.entries(DRESS_CODES).map(([k, v]) => [k, v.hint]))
const fmt = (iso, o = { weekday: 'short', day: 'numeric', month: 'short' }) => new Date(iso + 'T12:00:00').toLocaleDateString('it-IT', o)
const range = (p) => (p.start_on === p.end_on ? fmt(p.start_on, { weekday: 'long', day: 'numeric', month: 'long' }) : `${fmt(p.start_on)} – ${fmt(p.end_on)}`)
const byId = () => new Map(state.items.map((i) => [i.id, i]))
const live_ = (it) => it && !it.archived

// meteo per scheda, caricato una volta per apertura
const wx = new Map() // id piano → { status, data }
function weatherFor(plan, rerender) {
  const key = `${plan.id}|${plan.start_on}|${plan.end_on}|${plan.place?.lat}`
  const cur = wx.get(key)
  if (cur) return cur
  const entry = { status: 'loading', data: {} }
  wx.set(key, entry)
  ;(async () => {
    const place = plan.place?.lat ? plan.place : await getPlace().catch(() => null)
    if (!place) { entry.status = 'noplace'; rerender(); return }
    try { entry.data = await getRangeWeather(place, plan.start_on, plan.end_on); entry.status = 'done' } catch { entry.status = 'error' }
    entry.place = place
    rerender()
  })()
  return entry
}

function wxLine(w, when) {
  if (!w) return null
  if (when === 'sera') return h('span', { class: 'pwx' }, `circa ${Math.round(w.tmax)}°`, h('small', null, 'di sera'))
  return h('span', { class: 'pwx' }, `${Math.round(w.tmax)}° / ${Math.round(w.tmin)}°`,
    w.rainProb != null ? h('span', null, h('span', { html: icon.rain }), ` ${w.rainProb}%`) : null,
    h('small', null, w.kind === 'typical' ? 'tipico del periodo' : 'previsto'))
}

// ---------- Elenco ----------------------------------------------------
export function render(root, { go }) {
  const today = toDay(new Date())
  const next = state.plans.filter((p) => p.end_on >= today)
  const past = state.plans.filter((p) => p.end_on < today).reverse()
  const card = (p) => {
    const chosen = p.kind === 'event' ? (p.outfits || []).some((o) => o.items?.length) : (p.outfits || []).length === (p.days || []).length && p.outfits.length > 0
    const dress = [...new Set((p.days || []).map((d) => DRESS[d.dress]).filter(Boolean))].join(', ')
    return h('a', { class: 'plan label', href: `#/eventi/${p.id}` },
      h('span', { class: 'plan-ic', html: p.kind === 'trip' ? icon.trip : icon.event }),
      h('span', { class: 'plan-b' },
        h('b', null, p.title),
        h('span', null, [range(p), p.place?.name?.split(',')[0]].filter(Boolean).join(' · ')),
        h('small', null, [dress, chosen ? (p.kind === 'trip' ? 'valigia pronta' : 'outfit scelto') : 'outfit da scegliere'].filter(Boolean).join(' · '))))
  }
  add(root,
    h('div', { class: 'plan-new' },
      h('button', { class: 'btn', onclick: () => go('#/eventi/nuovo/evento') }, h('span', { html: icon.event }), 'Nuovo evento'),
      h('button', { class: 'btn ghost', onclick: () => go('#/eventi/nuovo/viaggio') }, h('span', { html: icon.trip }), 'Nuovo viaggio')),
    next.length ? h('div', { class: 'plans' }, next.map(card))
      : h('div', { class: 'empty' }, h('h3', null, 'Nessun evento in programma'),
        h('p', null, 'Un evento (una cena di lavoro, una cerimonia) riceve tre proposte per il suo dress code e il meteo del giorno. Un viaggio riceve un outfit per ogni giorno, con gli impegni che indichi, usando meno capi possibile in valigia.')),
    past.length ? h('details', { class: 'past' }, h('summary', null, `Passati (${past.length})`), h('div', { class: 'plans' }, past.map(card))) : null,
  )
}

// ---------- Scheda ----------------------------------------------------
export function renderPlan(root, { go, params, rerender }) {
  const plan = state.plans.find((p) => p.id === params.id)
  if (!plan) { add(root, h('div', { class: 'empty' }, h('h3', null, 'Evento non trovato'), h('button', { class: 'btn', onclick: () => go('#/eventi') }, 'Torna all’elenco'))); return }
  const w = weatherFor(plan, rerender)
  const head = h('div', { class: 'plan-head' },
    h('h2', null, plan.title),
    h('p', { class: 'muted' }, [range(plan), plan.place?.name].filter(Boolean).join(' · ')),
    plan.notes ? h('p', { class: 'notes' }, plan.notes) : null,
    w.status === 'noplace' ? h('p', { class: 'fhint' }, 'Senza luogo né città nelle impostazioni uso il clima della stagione.') : null)
  add(root, head, plan.kind === 'trip' ? tripBody(plan, w, rerender) : eventBody(plan, w),
    h('div', { class: 'actions' },
      h('button', { class: 'btn ghost', onclick: () => go(`#/eventi/${plan.id}/modifica`) }, 'Modifica'),
      h('button', { class: 'btn danger', onclick: () => {
        if (!confirm(`Eliminare “${plan.title}”?`)) return
        remove('plans', plan.id); toast('Eliminato'); go('#/eventi')
      } }, 'Elimina')))
  hydrate(root)
}

function strip(items, slots) {
  return h('div', { class: 'strip' }, items.map((it) => h('a', { href: `#/capo/${it.id}`, class: 'strip-it' }, thumb(it),
    h('small', null, SLOTS[slots?.(it) || slotOf(it)] || ''))))
}
function wearButton(plan, items, date) {
  if (date !== toDay(new Date())) return null
  const worn = items.every((it) => state.wearLog.some((x) => x.item_id === it.id && x.worn_on === date))
  if (worn) return h('p', { class: 'fhint' }, 'Segnato come indossato oggi.')
  return h('button', { class: 'btn', onclick: () => {
    const outfitId = uuid()
    const occ = DRESS_CODES[(plan.days || []).find((d) => d.date === date)?.dress]?.occ?.[0] || null
    upsert('wear_log', items.map((it) => ({ id: uuid(), item_id: it.id, worn_on: date, outfit_id: outfitId, occasion: occ })), { onConflict: 'item_id,worn_on', ignoreDuplicates: true })
    toast('Segnato come indossato oggi')
  } }, h('span', { html: icon.check }), 'Indossato oggi')
}
const missingText = (missing) => {
  const names = { top: 'qualcosa da mettere sopra', bottom: 'pantaloni', shoes: 'scarpe', jacket: 'una giacca sartoriale' }
  return `Mancano capi adatti: ${missing.map((m) => names[m]).filter(Boolean).join(', ')}. Controlla le occasioni dei capi, o l’interruttore “va bene sotto la giacca”.`
}

function eventBody(plan, w) {
  const day = plan.days?.[0] || { date: plan.start_on, dress: 'business_casual' }
  const weather = w.data?.[day.date] || null
  const ids = byId()
  const chosen = (plan.outfits || []).find((o) => o.items?.length)
  const info = h('div', { class: 'plan-info' }, h('span', { class: 'dress' }, DRESS[day.dress] || ''), w.status === 'loading' ? h('span', { class: 'muted' }, 'meteo in arrivo…') : wxLine(weather))
  if (chosen) {
    const items = chosen.items.map((id) => ids.get(id)).filter(live_)
    return [info, h('article', { class: 'outfit label' },
      h('header', null, h('h3', null, 'Outfit scelto')),
      strip(items), h('p', { class: 'names' }, items.map(itemName).join(' + ')),
      chosen.reason ? h('p', { class: 'reason' }, chosen.reason) : null,
      items.length < chosen.items.length ? h('p', { class: 'fhint' }, 'Qualche capo è stato eliminato o archiviato: scegli di nuovo.') : null,
      wearButton(plan, items, day.date),
      h('button', { class: 'btn ghost', onclick: () => patch('plans', plan.id, { outfits: [] }) }, 'Cambia outfit'))]
  }
  if (w.status === 'loading') return [info, h('p', { class: 'muted' }, 'Preparo le proposte…')]
  const res = eventOutfits({ items: state.items, dress: day.dress, weather, date: day.date })
  if (!res.outfits.length) return [info, h('div', { class: 'empty' }, h('p', null, missingText(res.missing)))]
  return [info,
    res.missing.includes('jacket') ? h('p', { class: 'note' }, 'Nessuna giacca sartoriale adatta: le proposte ne sono prive.') : null,
    h('div', { class: 'outfits' }, res.outfits.map((o, i) => h('article', { class: 'outfit label' },
      h('header', null, h('h3', null, `Proposta ${i + 1}`)),
      strip(o.items), h('p', { class: 'names' }, o.items.map(itemName).join(' + ')),
      h('p', { class: 'reason' }, o.reason),
      h('button', { class: 'btn', onclick: () => { patch('plans', plan.id, { outfits: [{ date: day.date, items: o.items.map((it) => it.id), reason: o.reason }] }); toast('Outfit scelto') } },
        h('span', { html: icon.check }), 'Scegli questo'))))]
}

const generating = new Set()
function tripBody(plan, w, rerender) {
  const days = plan.days || []
  const ids = byId()
  const valid = outfitsMatch(days, plan.outfits)
  if (!valid) {
    if (w.status === 'loading') return h('p', { class: 'muted' }, 'Preparo la valigia: aspetto il meteo della destinazione…')
    if (!generating.has(plan.id)) {
      generating.add(plan.id)
      const outfits = planTrip({ items: state.items, days, weatherByDate: w.data || {} })
      patch('plans', plan.id, { outfits }).finally(() => generating.delete(plan.id))
    }
    return h('p', { class: 'muted' }, 'Preparo la valigia…')
  }
  const pack = packingList(plan.outfits, state.items)
  const regen = () => { const outfits = planTrip({ items: state.items, days, weatherByDate: w.data || {} }); patch('plans', plan.id, { outfits }); toast('Valigia rifatta') }
  const other = (i) => {
    const next = alternativeFor({ items: state.items, days, outfits: plan.outfits, i, weatherByDate: w.data || {} })
    const outfits = plan.outfits.slice(); outfits[i] = next
    patch('plans', plan.id, { outfits })
  }
  // un blocco per impegno: il giorno in testa alla scheda della giornata, la sera sotto
  const block = (o, i) => {
    const items = (o.items || []).map((id) => ids.get(id)).filter(live_)
    const evening = o.part === 'evening'
    return h('div', { class: 'tpart' + (evening ? ' evening' : '') },
      h('div', { class: 'tpart-h' }, evening ? h('b', null, PARTS.evening) : null, h('span', { class: 'dress' }, DRESS[o.dress] || ''),
        evening ? wxLine(eveningWeather(w.data?.[o.date]), 'sera') : null),
      items.length ? [strip(items), h('p', { class: 'names' }, items.map(itemName).join(' + ')), o.reason ? h('p', { class: 'reason' }, o.reason) : null]
        : h('p', { class: 'fhint' }, o.missing ? missingText(o.missing) : 'Nessun outfit per questo impegno.'),
      wearButton(plan, items, o.date),
      h('button', { class: 'mini', onclick: () => other(i) }, evening ? 'Altra proposta per la sera' : 'Altra proposta'))
  }
  const byDate = new Map()
  plan.outfits.forEach((o, i) => { if (!byDate.has(o.date)) byDate.set(o.date, []); byDate.get(o.date).push([o, i]) })
  const nEvenings = plan.outfits.filter((o) => o.part === 'evening').length
  return [
    section(`In valigia: ${pack.length} ${pack.length === 1 ? 'capo' : 'capi'} per ${days.length} ${days.length === 1 ? 'giorno' : 'giorni'}${nEvenings ? ` e ${nEvenings} ${nEvenings === 1 ? 'sera' : 'sere'}` : ''}`,
      h('div', { class: 'pack' }, pack.map((p) => h('a', { class: 'cell', href: `#/capo/${p.item.id}` }, thumb(p.item),
        h('span', { class: 'cell-n' }, itemName(p.item)), h('span', { class: 'cell-b' }, p.uses === 1 ? '1 volta' : `${p.uses} volte`)))),
      h('button', { class: 'link', onclick: regen }, 'Rifai la valigia da capo')),
    h('div', { class: 'tripdays' }, [...byDate].map(([date, list]) => h('article', { class: 'outfit label tripday' },
      h('header', null, h('h3', null, fmt(date, { weekday: 'long', day: 'numeric', month: 'short' }))),
      wxLine(w.data?.[date]),
      list.map(([o, i]) => block(o, i))))),
  ]
}

// ---------- Modulo ----------------------------------------------------
export function renderForm(root, { go, params, rerender }) {
  const existing = params.id ? state.plans.find((p) => p.id === params.id) : null
  const kind = existing?.kind || (params.kind === 'viaggio' ? 'trip' : 'event')
  const today = toDay(new Date())
  const d = existing ? structuredClone(existing) : { kind, title: '', place: null, start_on: today, end_on: today, days: [{ date: today, dress: kind === 'trip' ? 'casual' : 'business_casual' }], notes: '' }
  if (!existing && kind === 'trip') { d.start_on = today; d.end_on = addDaysIso(today, 3); d.days = daysFor(d.start_on, d.end_on, []) }
  let found = []
  const wrap = h('form', { class: 'itemform', novalidate: true, onsubmit: (e) => { e.preventDefault(); save() } })
  add(root, wrap)

  const ctl = {}
  function collect() {
    d.title = ctl.title.value.trim()
    d.notes = ctl.notes.value.trim() || null
    if (kind === 'event') {
      d.start_on = d.end_on = ctl.date.value || today
      d.days = [{ date: d.start_on, dress: ctl.dress.value || 'business_casual' }]
    } else {
      const s = ctl.start.value || today, e = ctl.end.value || s
      d.start_on = s; d.end_on = e < s ? s : e
      const byDate = Object.fromEntries((d.days || []).map((x) => [x.date, { ...x }]))
      wrap.querySelectorAll('select[data-date]').forEach((el) => {
        const x = (byDate[el.dataset.date] ||= { date: el.dataset.date })
        if (el.dataset.part === 'evening') x.evening = el.value || null
        else x.dress = el.value
      })
      d.days = daysFor(d.start_on, d.end_on, Object.values(byDate))
    }
  }
  async function find() {
    const q = ctl.q.value.trim()
    if (!q) return
    try { found = await searchCity(q) } catch { found = []; toast('Ricerca città non disponibile offline') }
    collect(); build()
  }
  function build() {
    ctl.title = h('input', { type: 'text', value: d.title || '', placeholder: kind === 'trip' ? 'es. Bruxelles, riunioni UE' : 'es. Cena con il CdA', required: true, autocomplete: 'off' })
    ctl.q = h('input', { type: 'search', placeholder: 'Città', enterkeyhint: 'search', onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); find() } } })
    ctl.notes = h('textarea', { rows: 2, placeholder: 'Facoltativo' }, d.notes || '')
    if (kind === 'event') {
      ctl.date = h('input', { type: 'date', value: d.start_on })
      ctl.dress = choices(DRESS, d.days?.[0]?.dress || 'business_casual', { hints: DRESS_HINT })
    } else {
      ctl.start = h('input', { type: 'date', value: d.start_on, onchange: () => { collect(); build() } })
      ctl.end = h('input', { type: 'date', value: d.end_on, min: d.start_on, onchange: () => { collect(); build() } })
    }
    const placeBox = [
      d.place ? h('p', { class: 'chosen-place' }, h('b', null, d.place.name), h('button', { type: 'button', class: 'link', onclick: () => { collect(); d.place = null; build() } }, 'Cambia')) : null,
      d.place ? null : field('Dove', h('div', { class: 'row-btn' }, ctl.q, h('button', { type: 'button', class: 'btn ghost', onclick: find }, 'Cerca')),
        kind === 'trip' ? 'Serve per il meteo della destinazione.' : 'Facoltativo: senza città uso quella delle impostazioni.'),
      !d.place && found.length ? h('ul', { class: 'cities' }, found.map((c) => h('li', null, h('button', { type: 'button', class: 'link', onclick: () => { collect(); d.place = c; found = []; build() } }, c.name)))) : null,
    ]
    const setAll = (dress) => { collect(); d.days = d.days.map((x) => ({ ...x, dress })); build() }
    const setEvenings = (evening) => { collect(); d.days = d.days.map((x) => ({ ...x, evening })); build() }
    const sel = (x, part) => h('select', { 'data-date': x.date, 'data-part': part, 'aria-label': `${fmt(x.date)}, ${PARTS[part].toLowerCase()}` },
      part === 'evening' ? h('option', { value: '', selected: !x.evening }, 'Nessun cambio') : null,
      Object.entries(DRESS).map(([k, v]) => h('option', { value: k, selected: (part === 'evening' ? x.evening : x.dress) === k }, v)))
    put(wrap,
      section(null,
        field('Nome', ctl.title),
        kind === 'event' ? field('Data', ctl.date) : h('div', { class: 'row2' }, field('Dal', ctl.start), field('Al', ctl.end)),
        placeBox),
      kind === 'event'
        ? section('Dress code', ctl.dress)
        : section('Impegni giorno per giorno',
          h('p', { class: 'fhint' }, d.days.length >= 21 ? 'Al massimo 21 giorni.' : 'Per ogni giornata il dress code del giorno e, se ti cambi, quello della sera (cena, evento). Il primo e l’ultimo giorno spesso sono di viaggio (casual).'),
          h('div', { class: 'allset' }, h('span', null, 'Tutti i giorni:'), Object.entries(DRESS).map(([k, v]) => h('button', { type: 'button', class: 'mini', onclick: () => setAll(k) }, v))),
          h('div', { class: 'allset' }, h('span', null, 'Tutte le sere:'), h('button', { type: 'button', class: 'mini', onclick: () => setEvenings(null) }, 'Nessun cambio'),
            ['casual', 'business_casual', 'smart', 'formal'].map((k) => h('button', { type: 'button', class: 'mini', onclick: () => setEvenings(k) }, DRESS[k]))),
          h('div', { class: 'daylist' },
            h('div', { class: 'dayrow head' }, h('small', null, PARTS.day), h('small', null, PARTS.evening)),
            d.days.map((x) => h('div', { class: 'dayrow' }, h('span', null, fmt(x.date)), sel(x, 'day'), sel(x, 'evening'))))),
      section(null, field('Note', ctl.notes)),
      h('div', { class: 'savebar' },
        h('button', { type: 'button', class: 'btn ghost', onclick: () => history.back() }, 'Annulla'),
        h('button', { type: 'submit', class: 'btn' }, 'Salva')))
  }
  function save() {
    collect()
    if (!d.title) { toast('Dai un nome'); ctl.title.focus(); return }
    if (kind === 'trip' && !d.place) { toast('Scegli la destinazione'); ctl.q.focus(); return }
    const changed = !existing || existing.start_on !== d.start_on || existing.end_on !== d.end_on || JSON.stringify(existing.days) !== JSON.stringify(d.days) || existing.place?.name !== d.place?.name
    const id = existing?.id || uuid()
    upsert('plans', { id, kind, title: d.title, place: d.place, start_on: d.start_on, end_on: d.end_on, days: d.days, notes: d.notes, outfits: changed ? [] : existing.outfits || [] })
    toast(existing ? 'Salvato' : kind === 'trip' ? 'Viaggio creato' : 'Evento creato')
    go(`#/eventi/${id}`, { replace: !existing })
  }
  build()
}

function addDaysIso(iso, n) { const x = new Date(iso + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
function daysFor(start, end, prev) {
  const by = Object.fromEntries((prev || []).map((x) => [x.date, x]))
  const list = datesBetween(start, end).slice(0, 21)
  return list.map((date, i) => {
    const x = { date, dress: by[date]?.dress || (i === 0 || i === list.length - 1 ? 'casual' : 'business_casual') }
    if (by[date]?.evening) x.evening = by[date].evening
    return x
  })
}

// Oggi: se un evento o un viaggio ha un outfit per oggi, lo mostra in cima alla pagina Oggi
export function todayPlanCard() {
  const today = toDay(new Date())
  const ids = byId()
  for (const p of state.plans) {
    if (p.start_on > today || p.end_on < today) continue
    const parts = (p.outfits || []).filter((x) => x?.date === today && x.items?.length)
      .map((o) => ({ o, items: o.items.map((id) => ids.get(id)).filter(live_) })).filter((x) => x.items.length)
    if (!parts.length) continue
    return h('article', { class: 'outfit label planned' },
      h('header', null, h('h3', null, p.kind === 'trip' ? `In viaggio: ${p.title}` : p.title)),
      parts.map(({ o, items }) => h('div', { class: 'tpart' + (o.part === 'evening' ? ' evening' : '') },
        h('div', { class: 'tpart-h' }, o.part === 'evening' ? h('b', null, 'Stasera') : parts.length > 1 ? h('b', null, 'Di giorno') : null, h('span', { class: 'dress' }, DRESS[o.dress || p.days?.[0]?.dress] || '')),
        strip(items), h('p', { class: 'names' }, items.map(itemName).join(' + ')),
        wearButton(p, items, today))),
      h('a', { class: 'link', href: `#/eventi/${p.id}` }, 'Apri'))
  }
  return null
}
