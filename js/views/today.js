import { h, put, add, icon, toast, thumb, choices } from '../ui.js'
import { state, upsert, remove, uuid } from '../store.js'
import { suggestOutfits, toDay, itemName } from '../outfit.js'
import { getWeather } from '../weather.js'
import { OCCASIONS, OCCASION_HINT, SLOTS } from '../taxonomy.js'
import { hydrate } from '../images.js'
import { todayPlanCard } from './plans.js'

const defaultOcc = () => { const d = new Date().getDay(); return d === 0 || d === 6 ? 'casual' : 'work' }
let occasion = sessionStorage.getItem('occ') || defaultOcc()
let weather // undefined = in caricamento, null = non disponibile
// "Altre proposte": quello che hai già visto oggi per questa occasione non torna, e i capi già proposti scendono
let seen = { key: '', sigs: new Set(), shown: new Map(), rounds: 0 }
let loading = false

async function loadWeather(force, rerender) {
  if (loading) return
  loading = true
  weather = await getWeather({ force })
  loading = false
  rerender()
}

export const live = true
export const title = 'Oggi'

export function render(root, { go, rerender }) {
  if (weather === undefined) loadWeather(false, rerender)
  const today = toDay(new Date())

  const occ = choices(OCCASIONS, occasion, { hints: OCCASION_HINT, onchange: (v) => { occasion = v || occasion; sessionStorage.setItem('occ', occasion); rerender() } })

  const wornToday = state.wearLog.filter((w) => w.worn_on === today)
  const key = `${today}|${occasion}`
  if (seen.key !== key) seen = { key, sigs: new Set(), shown: new Map(), rounds: 0 }
  const bias = seen.rounds ? (it) => -0.12 * (seen.shown.get(it.id) || 0) : undefined
  let res = suggestOutfits({ items: state.items, wearLog: state.wearLog, occasion, weather: weather?.needPlace ? null : weather, avoid: seen.rounds ? seen.sigs : undefined, bias })
  // finite le combinazioni nuove: si riparte da capo
  if (seen.rounds && !res.outfits.length && !res.missing.filter((m) => m !== 'jacket').length) {
    seen = { key, sigs: new Set(), shown: new Map(), rounds: 0 }
    res = suggestOutfits({ items: state.items, wearLog: state.wearLog, occasion, weather: weather?.needPlace ? null : weather })
    toast('Non ci sono altre combinazioni: ecco di nuovo le prime')
  }
  const more = () => {
    for (const o of res.outfits) {
      seen.sigs.add(o.sig)
      for (const it of o.items) seen.shown.set(it.id, (seen.shown.get(it.id) || 0) + 1)
    }
    seen.rounds++
    rerender()
    requestAnimationFrame(() => document.querySelector('.outfits')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  add(root, 
    weatherStrip(go, rerender),
    todayPlanCard(),
    h('div', { class: 'occ' }, occ),
    wornToday.length ? wornCard(wornToday) : null,
    res.outfits.length && res.missing.includes('jacket') ? h('p', { class: 'note' }, 'Nessuna giacca sartoriale per il lavoro formale: le proposte ne sono prive.') : null,
    res.outfits.length
      ? h('div', { class: 'outfits' }, res.outfits.map((o, i) => outfitCard(o, i + 1 + seen.rounds * 3, today, !!wornToday.length)))
      : emptyState(res.missing, go),
    res.outfits.length ? h('div', { class: 'more' },
      h('button', { class: 'btn ghost', onclick: more }, h('span', { html: icon.sync }), 'Altre proposte'),
      seen.rounds ? h('button', { class: 'link', onclick: () => { seen = { key, sigs: new Set(), shown: new Map(), rounds: 0 }; rerender() } }, 'Torna alle prime') : null) : null,
  )
  hydrate(root)
}

function weatherStrip(go, rerender) {
  if (weather === undefined) return h('div', { class: 'wx muted' }, 'Meteo in arrivo…')
  if (weather?.needPlace) return h('button', { class: 'wx link', onclick: () => go('#/impostazioni') }, 'Posizione non disponibile: imposta una città per il meteo')
  if (!weather) return h('div', { class: 'wx muted' }, 'Meteo non disponibile: suggerimenti basati sulla stagione', h('button', { class: 'mini', onclick: () => { weather = undefined; loadWeather(true, rerender) } }, 'Riprova'))
  return h('div', { class: 'wx' },
    h('div', { class: 'wx-t' }, h('b', null, `${Math.round(weather.tmax)}°`), h('span', null, ` / ${Math.round(weather.tmin)}°`)),
    h('div', { class: 'wx-d' },
      h('span', null, h('span', { html: icon.rain }), ` ${weather.rainProb ?? 0}%`),
      h('span', null, h('span', { html: icon.wind }), ` ${Math.round(weather.windMax ?? 0)} km/h`),
      h('span', { class: 'wx-p' }, weather.place + (weather.stale ? ' · dati di stamattina' : ''))),
  )
}

function wornCard(rows) {
  const items = rows.map((w) => state.items.find((i) => i.id === w.item_id)).filter(Boolean)
  return h('div', { class: 'worn' },
    h('div', null, h('b', null, 'Oggi indossi'), h('p', null, items.map(itemName).join(', '))),
    h('button', { class: 'mini', onclick: () => { remove('wear_log', rows.map((r) => r.id)); toast('Registrazione di oggi annullata') } }, 'Annulla'))
}

function outfitCard(o, i, today, already) {
  const mark = () => {
    const outfitId = uuid()
    upsert('wear_log', o.items.map((it) => ({ id: uuid(), item_id: it.id, worn_on: today, outfit_id: outfitId, occasion })),
      { onConflict: 'item_id,worn_on', ignoreDuplicates: true })
    toast('Segnato come indossato oggi')
  }
  return h('article', { class: 'outfit label' },
    h('header', null, h('h3', null, `Proposta ${i}`)),
    h('div', { class: 'strip' }, o.items.map((it) => h('a', { href: `#/capo/${it.id}`, class: 'strip-it' }, thumb(it), h('small', null, SLOTS[slotKey(o, it)])))),
    h('p', { class: 'names' }, o.items.map(itemName).join(' + ')),
    h('p', { class: 'reason' }, o.reason),
    already ? null : h('button', { class: 'btn', onclick: mark }, h('span', { html: icon.check }), 'Indossato oggi'),
  )
}
const slotKey = (o, it) => (o.suit === 'full' && o.slots.jacket?.id === it.id ? 'suit' : Object.keys(o.slots).find((k) => o.slots[k]?.id === it.id))

function emptyState(missing, go) {
  const names = { top: 'una camicia, polo o t-shirt', bottom: 'un paio di pantaloni', shoes: 'un paio di scarpe', jacket: 'una giacca' }
  return h('div', { class: 'empty' },
    h('h3', null, 'Mancano capi per questa occasione'),
    h('p', null, `Aggiungi ${missing.map((m) => names[m]).join(', ')} con l’occasione “${OCCASIONS[occasion]}”.`),
    h('button', { class: 'btn', onclick: () => go('#/capo/nuovo') }, h('span', { html: icon.plus }), 'Aggiungi un capo'))
}
